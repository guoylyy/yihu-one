// 面向应用的大模型开放接口: POST /api/open/llm/chat/completions
// 平台统一托管模型与密钥; 应用凭凭证调用, 可选 X-User-Token 按人记用量、按角色过滤模型
// OpenAI 兼容: 应用把 OpenAI SDK 的 baseURL 指向平台即可
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { AppError, badRequest, forbidden } from '../lib/http.js'
import { verifyToken, loadUser } from '../lib/auth.js'
import { complete, listModels, getLlmConfig } from '../agent/llm.js'
import * as settings from './settings.js'

const DEFAULT_SYSTEM = '你是一个有用的助手。'
const ROLES = ['system', 'user', 'assistant', 'tool']
const PASSTHROUGH_PARAMS = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop']
const MAX_TOOLS = 64

/** 解析可选的用户 access_token(X-User-Token): 必须是统一认证签给本应用的 app token */
export async function resolveUser(app, token, ip) {
  if (!token) return { user: null, ctx: { user: null, via: 'APP', ip } }
  let p
  try { p = verifyToken(token) } catch { throw new AppError(401, 'access_token 无效或已过期', 1002) }
  if (p.type !== 'app') throw new AppError(401, 'access_token 类型不正确', 1002)
  if (String(p.aud || '') !== app.code) throw new AppError(401, 'access_token 不是签给本应用的', 1002)
  const user = await loadUser(p.sub)
  if (!user) throw new AppError(401, '用户不存在或已停用', 1002)
  return { user, ctx: { user, via: 'APP', ip } }
}

/**
 * 模型解析。body.model = 平台已配置模型的上游模型名(OpenAI 惯例)
 * 指定 → 角色允许才可用; 不指定 → 平台默认模型
 */
export async function resolveCfg(body, user) {
  const wanted = String(body.model || '').trim()
  if (wanted) {
    const allowed = await listModels(user)
    const hit = allowed.find(m => m.model === wanted)
    if (hit) return getLlmConfig({ modelId: hit.id, user })
    const all = await listModels(null)
    if (all.some(m => m.model === wanted)) throw forbidden('当前账号无权使用该模型')
    throw new AppError(404, `模型 ${wanted} 未配置或未启用`, 1004)
  }
  const cfg = await getLlmConfig({ user })
  if (!cfg) throw new AppError(503, '平台尚未配置可用模型，请在「管理 → 模型与 AI」中配置', 1006)
  return cfg
}

/** 从消息中抽出 system, 其余原样保留(OpenAI/Anthropic 转换都在调用边界做) */
function splitSystem(messages) {
  const systems = messages.filter(m => m.role === 'system').map(m => String(m.content || '')).filter(Boolean)
  return {
    system: systems.join('\n\n') || DEFAULT_SYSTEM,
    messages: messages.filter(m => m.role !== 'system')
  }
}

/** 采样参数白名单透传 + 单次 max_tokens */
function pickParams(body) {
  const out = {}
  for (const k of PASSTHROUGH_PARAMS) {
    if (body[k] !== undefined && body[k] !== null) out[k] = body[k]
  }
  const mt = body.max_completion_tokens ?? body.max_tokens
  if (mt !== undefined && mt !== null) {
    const n = Number(mt)
    if (!Number.isInteger(n) || n < 1) throw badRequest('max_tokens 须为正整数')
    out.maxTokens = n
  }
  return out
}

function validateBody(body) {
  if (!body || typeof body !== 'object') throw badRequest('请求体格式不对')
  if (!Array.isArray(body.messages) || !body.messages.length) throw badRequest('messages 不能为空')
  body.messages.forEach((m, i) => {
    if (!m || typeof m !== 'object' || !ROLES.includes(m.role)) throw badRequest(`messages[${i}].role 须为 system / user / assistant / tool`)
    if (m.role !== 'assistant' && m.content == null) throw badRequest(`messages[${i}].content 不能为空`)
  })
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.length > MAX_TOOLS) throw badRequest(`tools 最多 ${MAX_TOOLS} 个`)
    body.tools.forEach((t, i) => {
      if (t?.type !== 'function' || !t.function?.name) throw badRequest(`tools[${i}] 须为 function 类型且含 function.name`)
    })
  }
}

/** 用量兜底估算(模型没回 usage 时): CJK 按字、其余按字符/4 */
export function estimateTokens(text) {
  let cjk = 0, other = 0
  for (const ch of String(text)) {
    const code = ch.codePointAt(0)
    if (code >= 0x3400 && code <= 0x9fff) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

function usageOf(result, system, messages, completionText) {
  const prompt = result.usage?.promptTokens
    || estimateTokens(system) + messages.reduce((n, m) => n + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''))
      + (m.tool_calls || []).reduce((x, t) => x + estimateTokens(t.function?.name || '') + estimateTokens(t.function?.arguments || ''), 0), 0)
  const completion = result.usage?.completionTokens || estimateTokens(completionText)
  return { prompt, completion, total: prompt + completion }
}

/** 用量事件落库(失败只记日志, 不影响响应) */
async function recordEvent(app, user, model, usage, latencyMs, status) {
  try {
    await prisma.llmUsageEvent.create({
      data: {
        appId: app.id, userId: user?.id ?? null, model,
        promptTokens: usage.prompt, completionTokens: usage.completion, totalTokens: usage.total,
        latencyMs, status
      }
    })
  } catch (e) { console.error('[llm-usage]', e.message) }
}

/** 配额: 应用设置(null 时用全局默认, 0=不限); 当日 token 已达上限则拒绝 */
export async function assertQuota(app) {
  const limit = app.llmDailyTokenLimit ?? (await settings.get('llm')).dailyTokenLimit
  if (!limit) return
  const todayUtc = new Date()
  todayUtc.setUTCHours(0, 0, 0, 0)
  const agg = await prisma.llmUsageEvent.aggregate({
    where: { appId: app.id, createdAt: { gte: todayUtc } },
    _sum: { totalTokens: true }
  })
  if ((agg._sum.totalTokens || 0) >= limit) {
    throw new AppError(429, '该应用今日大模型 token 用量已达配额上限', 1005)
  }
}

/** 上游错误转成带状态码的 AppError(消息里带「返回 N」时沿用 N, 否则 502) */
function upstreamError(e) {
  const m = /返回 (\d{3})/.exec(e.message || '')
  return new AppError(m ? Number(m[1]) : 502, `大模型调用失败：${e.message}`.slice(0, 500), m ? 5002 : 5001)
}

const newId = () => `chatcmpl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** 非流式: 返回 OpenAI chat.completion 对象 */
export async function chatCompletion(app, body, { ip, userToken } = {}) {
  const { user, ctx } = await resolveUser(app, userToken, ip)
  validateBody(body)
  const cfg = await resolveCfg(body, user)
  await assertQuota(app)
  const { system, messages } = splitSystem(body.messages)
  const params = pickParams(body)
  const startedAt = Date.now()
  let result
  try {
    result = await complete(cfg, { system, messages, tools: body.tools, params })
  } catch (e) {
    await recordEvent(app, user, cfg.model, { prompt: 0, completion: 0, total: 0 }, Date.now() - startedAt, 'ERROR')
    throw upstreamError(e)
  }
  const latencyMs = Date.now() - startedAt
  const usage = usageOf(result, system, messages, result.content)
  await recordEvent(app, user, cfg.model, usage, latencyMs, 'OK')
  audit(ctx, 'llm.chat', { entityType: 'app', entityId: app.id, detail: { model: cfg.model, totalTokens: usage.total, stream: false } })
  const finishReason = result.toolCalls.length ? 'tool_calls' : 'stop'
  const message = { role: 'assistant', content: result.content || (result.toolCalls.length ? null : '') }
  if (result.toolCalls.length) {
    message.tool_calls = result.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
  }
  return {
    id: newId(), object: 'chat.completion', created: Math.floor(startedAt / 1000), model: cfg.model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.total }
  }
}

/** 流式: OpenAI SSE, 直接写 res */
export async function streamCompletion(app, body, { ip, userToken } = {}, res) {
  const { user, ctx } = await resolveUser(app, userToken, ip)
  validateBody(body)
  const cfg = await resolveCfg(body, user)
  await assertQuota(app)
  const { system, messages } = splitSystem(body.messages)
  const params = pickParams(body)

  const id = newId()
  const created = Math.floor(Date.now() / 1000)
  const baseChunk = { id, object: 'chat.completion.chunk', created, model: cfg.model }
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (choices, extra = {}) => res.write(`data: ${JSON.stringify({ ...baseChunk, ...extra, choices })}\n\n`)

  // 客户端断开则中止上游调用
  const controller = new AbortController()
  let closed = false
  const onClose = () => { closed = true; controller.abort() }
  res.req.on('close', onClose)

  send([{ index: 0, delta: { role: 'assistant' }, finish_reason: null }])

  const startedAt = Date.now()
  let result
  try {
    result = await complete(cfg, {
      system, messages, tools: body.tools, params, signal: controller.signal,
      onText: (text) => { if (!closed) send([{ index: 0, delta: { content: text }, finish_reason: null }]) }
    })
  } catch (e) {
    res.req.off('close', onClose)
    await recordEvent(app, user, cfg.model, { prompt: 0, completion: 0, total: 0 }, Date.now() - startedAt, 'ERROR')
    if (!closed) {
      res.write(`data: ${JSON.stringify({ error: { message: e.message, type: 'upstream_error', code: 5002 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }
    return
  }
  res.req.off('close', onClose)
  const latencyMs = Date.now() - startedAt
  const finishReason = result.toolCalls.length ? 'tool_calls' : 'stop'
  if (result.toolCalls.length) {
    send([{
      index: 0,
      delta: { tool_calls: result.toolCalls.map((c, i) => ({ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) },
      finish_reason: null
    }])
  }
  const usage = usageOf(result, system, messages, result.content)
  await recordEvent(app, user, cfg.model, usage, latencyMs, 'OK')
  audit(ctx, 'llm.chat', { entityType: 'app', entityId: app.id, detail: { model: cfg.model, totalTokens: usage.total, stream: true } })
  if (!closed) {
    send([{ index: 0, delta: {}, finish_reason: finishReason }])
    send([], { usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.total } })
    res.write('data: [DONE]\n\n')
    res.end()
  }
}
