// 大模型调用层(带工具调用)
// 消息统一用 OpenAI chat 格式在系统内流转; Anthropic 在调用边界做格式转换
// 配置来源: 「管理 → 模型配置」, 用户可在允许的模型里选; 后台一个都没配时用 .env 的 LLM_* 兜底
import Anthropic from '@anthropic-ai/sdk'
import prisma from '../lib/prisma.js'
import { encryptJson, decryptJson } from '../lib/secret.js'

/** 模型密钥加密存储(v1. 前缀); 兼容早期明文 */
export const sealKey = (k) => encryptJson({ k })
export function openKey(stored) {
  if (!stored) return ''
  if (!stored.startsWith('v1.')) return stored
  try { return decryptJson(stored).k || '' } catch { return '' }
}

const ENV_MODEL_ID = 0

/**
 * 取一个可用的 embedding 模型(含明文 key)。kind=EMBEDDING; modelId 指定时用它
 * 找不到返回 null(让调用方提示管理员去「模型与 AI」加一个 embedding 模型)
 */
export async function getEmbeddingConfig({ modelId } = {}) {
  const rows = await prisma.llmConfig.findMany({
    where: { deletedAt: null, enabled: true, kind: 'EMBEDDING' },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }]
  })
  const m = (modelId ? rows.find(x => x.id === Number(modelId)) : rows[0]) || null
  if (!m) return null
  return { ...m, apiKey: openKey(m.apiKey) }
}

/**
 * 文本 → 向量(OpenAI 兼容 /embeddings)。input 可多条, 批量返回
 * 返回 number[][]（顺序与 input 一致）
 */
export async function embed(input, { dimensions, modelId } = {}) {
  const cfg = await getEmbeddingConfig({ modelId })
  if (!cfg) throw new Error('还没有配置向量模型：请管理员在「模型与 AI → 新增模型」里加一个 embedding 模型（类型选 OpenAI 兼容，如通义 text-embedding-v3）')
  const base = (cfg.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
  const list = Array.isArray(input) ? input : [input]
  const body = { model: cfg.model, input: list, ...(dimensions ? { dimensions } : {}) }
  let resp
  try {
    resp = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    })
  } catch (e) {
    throw new Error(`向量模型连不上：${e.message}`)
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`向量模型返回 ${resp.status}: ${t.slice(0, 300)}`)
  }
  const data = await resp.json()
  const byIndex = new Map((data.data || []).map(d => [d.index, d.embedding]))
  return list.map((_, i) => byIndex.get(i) || [])
}


/** 环境变量兜底模型: 后台一个模型都没配时才用, 方便首次部署 */
function envModel() {
  if (!process.env.LLM_API_KEY || !process.env.LLM_MODEL) return null
  return {
    id: ENV_MODEL_ID, name: `${process.env.LLM_MODEL}（环境变量）`, description: '后台尚未配置模型，临时使用环境变量里的配置',
    provider: process.env.LLM_PROVIDER || 'OPENAI_COMPAT', baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL,
    apiKey: process.env.LLM_API_KEY, maxTokens: 4096, extra: null, isDefault: true, roles: null, selectable: true
  }
}

const allowedFor = (m, user) => !user || !Array.isArray(m.roles) || !m.roles.length || m.roles.some(r => user.roles.includes(r))

/** 用户可选的模型(按角色过滤), 默认模型排第一 */
export async function listModels(user, kind = 'CHAT') {
  const rows = await prisma.llmConfig.findMany({
    where: { deletedAt: null, enabled: true, kind },
    orderBy: [{ isDefault: 'desc' }, { sort: 'asc' }, { id: 'asc' }]
  })
  if (!rows.length) {
    const e = envModel()
    return e ? [e] : []
  }
  return rows.filter(m => allowedFor(m, user))
}

/**
 * 取本次对话用的模型(含明文 key)
 * modelId 指定且用户有权使用 → 用它; 否则用默认模型(isDefault 优先的第一个可用项)
 */
export async function getLlmConfig({ modelId, user, selectableOnly = false } = {}) {
  const models = await listModels(user)
  let m = null
  if (modelId !== undefined && modelId !== null && modelId !== '') {
    m = models.find(x => x.id === Number(modelId) && (!selectableOnly || x.selectable || x.isDefault)) || null
  }
  m ||= models[0] || null
  if (!m) return null
  return { ...m, apiKey: m.id === ENV_MODEL_ID ? m.apiKey : openKey(m.apiKey) }
}

/**
 * 一轮模型调用(流式)。onText(delta) 实时回调文字增量
 * params: 每次调用的采样参数(temperature/top_p/frequency_penalty/presence_penalty/stop/maxTokens)
 * 返回 { content, toolCalls: [{ id, name, arguments(string) }], usage: { promptTokens, completionTokens } }
 */
export async function complete(cfg, { system, messages, tools, onText, signal, requireTool = false, params = {} }) {
  if (cfg.provider === 'ANTHROPIC') return completeAnthropic(cfg, { system, messages, tools, onText, signal, requireTool, params })
  return completeOpenAi(cfg, { system, messages, tools, onText, signal, requireTool, params })
}

const PASSTHROUGH_PARAMS = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop']

async function completeOpenAi(cfg, { system, messages, tools, onText, signal, requireTool, params }) {
  const base = (cfg.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
  const extra = {}
  for (const k of PASSTHROUGH_PARAMS) if (params[k] !== undefined) extra[k] = params[k]
  const body = {
    model: cfg.model,
    max_tokens: params.maxTokens || cfg.maxTokens || 4096,
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: 'system', content: system }, ...messages],
    ...extra,
    ...(tools?.length ? { tools, tool_choice: requireTool ? 'required' : 'auto' } : {})
  }
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`大模型接口返回 ${resp.status}: ${t.slice(0, 300)}`)
  }
  let content = ''
  let usage = null
  const calls = [] // index -> { id, name, arguments }
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of resp.body) {
    buf += decoder.decode(chunk, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let j
      try { j = JSON.parse(data) } catch { continue }
      if (j.usage) usage = { promptTokens: j.usage.prompt_tokens || 0, completionTokens: j.usage.completion_tokens || 0 }
      const delta = j.choices?.[0]?.delta
      if (!delta) continue
      if (delta.content) {
        content += delta.content
        onText?.(delta.content)
      }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? 0
        calls[i] ||= { id: '', name: '', arguments: '' }
        if (tc.id) calls[i].id = tc.id
        if (tc.function?.name) calls[i].name += tc.function.name
        if (tc.function?.arguments) calls[i].arguments += tc.function.arguments
      }
    }
  }
  return {
    content,
    toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` })),
    usage
  }
}

// ---------- Anthropic ----------

/** OpenAI 格式消息 → Anthropic messages */
function toAnthropicMessages(messages) {
  const out = []
  const push = (role, block) => {
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(block)
    else out.push({ role, content: [block] })
  }
  for (const m of messages) {
    if (m.role === 'user') push('user', { type: 'text', text: m.content })
    else if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content })
      for (const tc of m.tool_calls || []) {
        let input = {}
        try { input = JSON.parse(tc.function.arguments || '{}') } catch { /* 模型给了坏 JSON, 按空参数处理 */ }
        push('assistant', { type: 'tool_use', id: tc.id, name: tc.function.name, input })
      }
    } else if (m.role === 'tool') {
      push('user', { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content })
    }
  }
  return out
}

async function completeAnthropic(cfg, { system, messages, tools, onText, signal, requireTool, params }) {
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined })
  const options = {
    model: cfg.model,
    max_tokens: params.maxTokens || cfg.maxTokens || 4096,
    system,
    messages: toAnthropicMessages(messages),
    tools: (tools || []).map(t => ({
      name: t.function.name, description: t.function.description, input_schema: t.function.parameters
    })),
    ...(requireTool && tools?.length ? { tool_choice: { type: 'any' } } : {})
  }
  if (params.temperature !== undefined) options.temperature = params.temperature
  if (params.top_p !== undefined) options.top_p = params.top_p
  if (params.stop !== undefined) options.stop_sequences = Array.isArray(params.stop) ? params.stop : [params.stop]
  const stream = client.messages.stream(options, { signal })
  stream.on('text', (d) => onText?.(d))
  const final = await stream.finalMessage()
  const content = final.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const toolCalls = final.content.filter(b => b.type === 'tool_use')
    .map(b => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input || {}) }))
  return {
    content,
    toolCalls,
    usage: { promptTokens: final.usage.input_tokens || 0, completionTokens: final.usage.output_tokens || 0 }
  }
}
