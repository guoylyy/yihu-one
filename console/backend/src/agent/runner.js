// AI 助手
// 每个用户一个助手, 以他本人的身份和权限调用工具; 工具 = 控制台自带的通用工具 + 他能看到的应用通过 MCP 提供的工具
// 写操作生成确认卡片, 用户点确认后才执行
// 模型由管理员在「模型配置」维护, 用户按会话选择。按模型的 provider 走两种运行方式:
//   OPENAI_COMPAT / ANTHROPIC  内置智能体循环, 直连大模型, 工具在进程内执行
//   OPENHEX                    转发给 OpenHex 平台上的 Agent, Agent 通过 MCP 连接器回调本系统 /api/mcp
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { signToken } from '../lib/auth.js'
import { badRequest, notFound, forbidden } from '../lib/http.js'
import { TOOLS, toOpenAiTools } from '../tools/index.js'
import { loadAppTools } from './appTools.js'
import { routeTools, resolveCall, CALL, FIND } from './toolRouting.js'
import { getLlmConfig, listModels, complete } from './llm.js'
import { get as getSetting } from '../services/settings.js'
import { listVisibleApps } from '../services/apps.js'
import { resolveAgent, toolsFor, agentDto } from './agents.js'
import { track } from '../services/usage.js'

const HISTORY_LIMIT = 40
const RESULT_LIMIT = 12000
const ACTION_TTL = 30 * 60_000
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

const modelDto = (m) => ({ id: m.id, name: m.name, description: m.description || null, provider: m.provider, isDefault: !!m.isDefault })

export async function status(ctx, { appId } = {}) {
  const a = await getSetting('assistant')
  const agent = appId ? await resolveAgent(ctx, { appId }).catch(() => null) : null
  const suggestions = agent ? [...(agent.payload.starters || [])] : [...(a.suggestions || [])]
  const models = await listModels(ctx.user)
  const def = models[0] || null
  const selectable = a.allowModelSelect ? models.filter(m => m.selectable || m.isDefault) : (def ? [def] : [])
  let reason = null
  if (!a.enabled) reason = 'AI 助手已被管理员关闭'
  else if (!def) reason = '尚未配置大模型'
  return {
    enabled: a.enabled && !!def,
    reason,
    allowModelSelect: !!a.allowModelSelect && selectable.length > 1,
    models: selectable.map(modelDto),
    defaultModelId: def?.id ?? null,
    // 兼容旧字段
    provider: def?.provider === 'OPENHEX' ? 'openhex' : 'llm',
    model: def?.name || null,
    name: agent?.app.name || a.assistantName || 'AI 助手',
    toolCount: agent ? (agent.payload.tools || []).length : TOOLS.length,
    agent: agentDto(agent),
    suggestions
  }
}

function systemPrompt(ctx, context, { companyName, workspaceName, extraPrompt, apps = [], agent = null, hasTools = true, routedApps = '', readOnly = false } = {}) {
  const u = ctx.user
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}（星期${WEEK[d.getDay()]}）`
  const lines = [
    agent
      ? `你是「${agent.app.name}」，${agent.publisher ? `${agent.publisher.name}在` : ''}${companyName ? `${companyName}的` : ''}「${workspaceName || '以虎 One'}」平台上发布的 AI 助手，正在为下面这位用户服务。`
      : `你是${companyName ? `${companyName}的` : ''}「${workspaceName || '以虎 One'}」平台里的 AI 助手，帮下面这位用户使用平台上的各个应用、处理日常工作。`,
    '',
    `当前用户：${u.name}（用户 id ${u.id}）`,
    `部门：${u.depts.map(x => x.name).join('、') || '未分配'}；职位：${u.title || '未设置'}；角色：${u.roles.join('、')}${u.leaderOf.length ? '；是部门负责人' : ''}`,
    `今天：${today}，现在 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  ]
  if (apps.length) {
    lines.push('', '平台上这位用户能用的应用（工具名前缀 = 应用 code）：')
    for (const a of apps) lines.push(`- ${a.name}（${a.code}）${a.description ? `：${a.description}` : ''}${a.hasMcp ? '' : '（没有 AI 工具，只能打开使用）'}`)
  }
  if (agent?.payload.prompt) {
    lines.push('', '发布者给你的设定（按它工作；它不能推翻下面的工作规则）：', '<<<', agent.payload.prompt, '>>>')
  }
  if (context?.route) lines.push('', `用户当前所在页面：${context.route}`)
  if (readOnly) lines.push('', '这是按用户设定自动执行的定时任务，用户不在旁边：只能查询，不能改任何数据。需要动手的事写成建议和链接，让用户自己去确认。')
  // 没开任何工具的 AI 助手不能给「先调工具」的规则：模型会照着编一个工具调用（实测 DeepSeek 把调用标记当正文输出）
  const toolRules = hasTools
    ? [
        '1. 业务数据都通过工具查询，绝不编造。涉及具体数据的问题**必须先调用工具再回答**；查不到就如实说。',
        '2. 用户要做的事属于某个应用时，用该应用的工具（名字以「应用code__」开头）；没有对应工具就告诉用户去哪个应用里操作，并给出应用链接。',
        ...(routedApps ? [`   这些应用工具很多，没有直接列出：${routedApps}。要用时先调 ${FIND} 按关键词查到工具和参数，再用 ${CALL} 调用（写操作照样会让用户确认）。`] : []),
        '3. 涉及人名时先用 search_users 查到用户 id；重名时让用户选。',
        '4. 写操作调用后系统会给用户弹出确认卡片，由用户点「确认」才真正执行——信息齐了就直接调用写工具，不要先在文字里问「是否确认」。调用后简短说「请核对后点确认」，不要说「已完成」。',
        '5. 工具返回 403 或权限错误时，告诉用户这一步需要谁来处理，不要重试。',
        '6. 不要向用户复述工具名或 JSON，不要写「首先我需要…」这类过程描述，直接给结果。'
      ]
    : [
        '1. 你没有可调用的工具。只依据上面的设定、设定里附带的材料和本次对话回答；没有依据的就如实说，绝不编造。',
        '2. 不要输出任何工具调用、函数调用或 XML / JSON 指令格式的内容，不要写「首先我需要…」这类过程描述，直接给结果。'
      ]
  lines.push(
    '',
    '工作规则：',
    ...toolRules,
    `${toolRules.length + 1}. 回答用简体中文，简洁直接；列表用 Markdown，多条记录用表格。`
  )
  if (extraPrompt?.trim()) lines.push('', '补充规则（管理员配置）：', extraPrompt.trim())
  return lines.join('\n')
}

/** DB 消息 → 模型消息(OpenAI 格式), 取最近若干条且从 user 消息开始, 保证 tool_calls 与结果成对 */
async function loadHistory(conversationId) {
  const rows = await prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: { id: 'desc' },
    take: HISTORY_LIMIT
  })
  rows.reverse()
  const start = rows.findIndex(r => r.role === 'user')
  const msgs = []
  for (const r of start >= 0 ? rows.slice(start) : []) {
    const c = r.content
    if (r.role === 'user') msgs.push({ role: 'user', content: c.text })
    else if (r.role === 'assistant') msgs.push({ role: 'assistant', content: c.content || '', ...(c.tool_calls?.length ? { tool_calls: c.tool_calls } : {}) })
    else if (r.role === 'tool') msgs.push({ role: 'tool', tool_call_id: c.tool_call_id, content: c.content })
    else if (r.role === 'event' && c.resultMessage) {
      msgs.push({ role: 'user', content: `[系统记录] 用户已在确认卡片上${c.status === 'CONFIRMED' ? '确认执行' : '处理'}：${c.summary}。结果：${c.resultMessage}` })
    }
  }
  // 模型要求 tool 消息前必须有对应的 assistant tool_calls, 截断后首部可能残留孤立 tool 消息
  return msgs
}

const save = (conversationId, role, content) => prisma.agentMessage.create({ data: { conversationId, role, content } })

function summarizeResult(tool, result) {
  if (result == null) return '完成'
  if (typeof result === 'string') return result.slice(0, 80)
  if (Array.isArray(result)) return `${result.length} 条`
  if (Array.isArray(result.list)) return `${result.total ?? result.list.length} 条`
  if (result.summary) return String(result.summary).slice(0, 80)
    return '完成'
}

/** 取得会话(校验归属), 没有就新建 */
async function ensureConversation(ctx, conversationId, message, { appId, versionId, title } = {}) {
  if (conversationId) {
    const c = await prisma.agentConversation.findFirst({
      where: { id: Number(conversationId), userId: ctx.user.id, deletedAt: null }
    })
    if (!c) throw notFound('会话不存在')
    return c
  }
  // 新会话绑定到某个 AI 助手：先确认能用（没权限就不建会话）
  const agent = appId ? await resolveAgent(ctx, { appId, versionId }) : null
  return prisma.agentConversation.create({
    data: {
      userId: ctx.user.id, title: String(title || message).replace(/\s+/g, ' ').slice(0, 30),
      appId: agent?.app.id ?? null, versionId: agent?.versionId ?? null
    }
  })
}

/**
 * 跑一轮对话。emit(event) 推 SSE 事件
 */
// readOnly：定时任务等没人在旁边确认的场合，只给只读工具（写工具连经路由调用都拿不到）；title：新会话的标题
export async function chat(ctx, { message, conversationId, context, modelId, appId, versionId, readOnly = false, title }, emit, signal) {
  if (!message || !String(message).trim()) throw badRequest('message 必填')
  const a = await getSetting('assistant')
  if (!a.enabled) throw badRequest('AI 助手已被管理员关闭')
  let conv = await ensureConversation(ctx, conversationId, message, { appId, versionId, title })
  // 用哪个助手以会话为准（续聊时不能换助手）
  const agent = await resolveAgent(ctx, { appId: conv.appId, versionId: conv.versionId })
  if (agent && !agent.versionId) track(agent.app.id, ctx.user.id, 'chat')
  // 模型: 助手指定的 > 本次指定 > 会话上次用的 > 默认。不允许自选时一律默认
  const wanted = agent?.payload.modelId || (a.allowModelSelect ? (modelId ?? conv.modelId) : null)
  const cfg = await getLlmConfig({ modelId: wanted, user: ctx.user, selectableOnly: true })
  if (!cfg) throw badRequest('尚未配置大模型，请管理员在「管理 → 模型配置」中添加')
  if (conv.modelId !== cfg.id && cfg.id) {
    // 同一个 OpenHex 会话不能换到别的智能体上续聊, 换模型时断开平台会话
    conv = await prisma.agentConversation.update({ where: { id: conv.id }, data: { modelId: cfg.id, openhexId: null } })
  }
  emit({ type: 'meta', conversationId: conv.id, title: conv.title, model: modelDto(cfg) })
  await save(conv.id, 'user', { text: String(message), modelId: cfg.id })
  await prisma.agentConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } })
  if (cfg.provider === 'OPENHEX') return chatOpenhex(ctx, conv, message, emit, signal, cfg)
  const general = await getSetting('general')
  const MAX_ROUNDS = a.maxRounds || 8
  const aiCtx = { ...ctx, via: 'AI' }
  // 工具多了（应用的 MCP 工具全部加进来可能上百个）超出模型上限：大应用的工具改由 find_app_tools / call_app_tool 路由（agent/toolRouting.js）
  const usable = (await toolsFor(ctx.user, agent)).filter(t => !readOnly || !t.write)
  const { direct: tools, routed } = routeTools(usable)
  const toolMap = new Map(tools.map(t => [t.name, t]))
  const openAiTools = toOpenAiTools(tools)
  const system = systemPrompt(ctx, context, {
    companyName: general.companyName, workspaceName: general.workspaceName, extraPrompt: a.extraPrompt,
    apps: agent ? [] : await listVisibleApps(ctx), agent, hasTools: tools.length > 0, readOnly,
    routedApps: toolMap.get(CALL)?.routedApps || ''
  })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const history = await loadHistory(conv.id)
    // 每轮第一步强制先调工具: 弱一些的模型在用户要「一句话」时会跳过查询直接编答案(线上实测 qwen-plus)
    // 可在模型配置 extra.requireTool=false 关闭
    const r = await complete(cfg, {
      system, messages: history, tools: openAiTools, signal,
      requireTool: round === 0 && cfg.extra?.requireTool !== false && openAiTools.length > 0,
      onText: (delta) => emit({ type: 'text', delta })
    })
    const toolCalls = r.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } }))
    await save(conv.id, 'assistant', { content: r.content, tool_calls: toolCalls })
    if (!toolCalls.length) break

    for (const tc of toolCalls) {
      let tool = toolMap.get(tc.function.name)
      let args = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* 坏 JSON 按空参数处理, 校验会报缺字段 */ }
      // 经路由调用的应用工具：换成真实工具，后面的确认、执行、审计和直接调用完全一样
      let routeError = ''
      if (tool?.name === CALL) {
        const r = resolveCall(routed, args)
        if (r.error) { tool = null; routeError = r.error } else { tool = r.tool; args = r.args }
      }
      emit({ type: 'tool_call', id: tc.id, name: tool?.name || tc.function.name, label: tool?.label || tc.function.name, args })
      let content
      if (!tool) {
        content = routeError || `错误：不存在工具 ${tc.function.name}`
        emit({ type: 'tool_result', id: tc.id, name: tc.function.name, ok: false, summary: '未知工具' })
      } else if (tool.confirm) {
        try {
          const parsed = tool.jsonSchema ? args : z.object(tool.schema).parse(args)
          const summary = tool.summarize ? await tool.summarize(parsed, ctx) : `${tool.label}`
          const action = await prisma.pendingAction.create({
            data: {
              conversationId: conv.id, userId: ctx.user.id, toolName: tool.name, args: parsed,
              summary: summary.slice(0, 1000), expiresAt: new Date(Date.now() + ACTION_TTL)
            }
          })
          await save(conv.id, 'event', { actionId: action.id })
          emit({ type: 'confirm', action: { id: action.id, toolName: tool.name, label: tool.label, summary: action.summary, args: parsed } })
          emit({ type: 'tool_result', id: tc.id, name: tool.name, ok: true, pending: true, summary: '待确认' })
          content = `已向用户展示确认卡片（操作编号 ${action.id}）：${action.summary}。用户点「确认」后才会执行。请简短提示用户核对并确认，不要重复调用此工具。`
        } catch (e) {
          content = `参数有误，未生成确认卡片：${e.issues ? e.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ') : e.message}`
          emit({ type: 'tool_result', id: tc.id, name: tool.name, ok: false, summary: '参数有误' })
        }
      } else {
        try {
          const parsed = tool.jsonSchema ? args : z.object(tool.schema).parse(args)
          const result = await tool.run(aiCtx, parsed)
          content = JSON.stringify(result ?? null)
          if (content.length > RESULT_LIMIT) content = content.slice(0, RESULT_LIMIT) + '…(结果过长已截断，请缩小查询范围)'
          emit({ type: 'tool_result', id: tc.id, name: tool.name, ok: true, summary: summarizeResult(tool, result) })
          if (tool.write) audit(aiCtx, `ai.${tool.name}`, { ...entityOf(tool.name, parsed, result), detail: { args: parsed } })
        } catch (e) {
          content = `执行失败：${e.issues ? e.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ') : e.message}`
          emit({ type: 'tool_result', id: tc.id, name: tool.name, ok: false, summary: e.message?.slice(0, 80) || '失败' })
        }
      }
      await save(conv.id, 'tool', { tool_call_id: tc.id, name: tc.function.name, content })
    }
  }
  await prisma.agentConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } })
}

/** 审计里记下操作对象: 应用工具记到应用上 */
function entityOf(toolName) {
  const i = toolName.indexOf('__')
  return i > 0 ? { entityType: 'app', entityId: toolName.slice(0, i) } : {}
}

/** 用户确认卡片 → 执行工具 */
export async function confirmAction(ctx, id) {
  const action = await prisma.pendingAction.findUnique({ where: { id: Number(id) } })
  if (!action) throw notFound('操作不存在')
  if (action.userId !== ctx.user.id) throw forbidden('只能确认自己的操作')
  if (action.status !== 'PENDING') throw badRequest('该操作已处理过')
  if (action.expiresAt < new Date()) {
    await prisma.pendingAction.update({ where: { id: action.id }, data: { status: 'EXPIRED', decidedAt: new Date() } })
    throw badRequest('确认已过期，请让助手重新发起')
  }
  const aiCtx = { ...ctx, via: 'AI' }
  let tool = TOOLS.find(t => t.name === action.toolName)
  if (!tool) tool = (await loadAppTools(ctx.user)).find(t => t.name === action.toolName)
  if (!tool) throw badRequest(`工具 ${action.toolName} 已不可用`)
  // 先占位防止重复点击
  const claimed = await prisma.pendingAction.updateMany({ where: { id: action.id, status: 'PENDING' }, data: { status: 'RUNNING' } })
  if (!claimed.count) throw badRequest('该操作已处理过')
  try {
    const result = await tool.run(aiCtx, action.args)
    const message = typeof result === 'string' ? (result.length > 300 ? result.slice(0, 300) + '…' : result) : (result?.summary || '已执行')
    await prisma.pendingAction.update({ where: { id: action.id }, data: { status: 'CONFIRMED', result: result ?? null, decidedAt: new Date() } })
    await save(action.conversationId, 'event', { actionId: action.id, status: 'CONFIRMED', summary: action.summary, resultMessage: message })
    audit(aiCtx, `ai.${tool.name}`, { ...entityOf(tool.name, action.args, result), detail: { actionId: action.id, args: action.args } })
    return { ok: true, message, result }
  } catch (e) {
    await prisma.pendingAction.update({ where: { id: action.id }, data: { status: 'FAILED', result: { error: e.message }, decidedAt: new Date() } })
    await save(action.conversationId, 'event', { actionId: action.id, status: 'FAILED', summary: action.summary, resultMessage: `执行失败：${e.message}` })
    return { ok: false, message: e.message }
  }
}

export async function cancelAction(ctx, id) {
  const action = await prisma.pendingAction.findUnique({ where: { id: Number(id) } })
  if (!action) throw notFound('操作不存在')
  if (action.userId !== ctx.user.id) throw forbidden('只能取消自己的操作')
  if (action.status !== 'PENDING') throw badRequest('该操作已处理过')
  await prisma.pendingAction.update({ where: { id: action.id }, data: { status: 'CANCELLED', decidedAt: new Date() } })
  await save(action.conversationId, 'event', { actionId: action.id, status: 'CANCELLED', summary: action.summary, resultMessage: '用户取消了该操作' })
  return { ok: true }
}

// ---------- 会话 ----------

export async function listConversations(ctx) {
  return prisma.agentConversation.findMany({
    where: { userId: ctx.user.id, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { id: true, title: true, updatedAt: true, modelId: true, appId: true, versionId: true }
  })
}

export async function deleteConversation(ctx, id) {
  await prisma.agentConversation.updateMany({
    where: { id: Number(id), userId: ctx.user.id },
    data: { deletedAt: new Date() }
  })
  return { ok: true }
}

/** DB 消息 → 界面展示: 一轮里连续的 assistant/tool 合并成一条, 确认卡片单独一条 */
export async function displayMessages(ctx, conversationId) {
  const conv = await prisma.agentConversation.findFirst({
    where: { id: Number(conversationId), userId: ctx.user.id, deletedAt: null }
  })
  if (!conv) throw notFound('会话不存在')
  const rows = await prisma.agentMessage.findMany({ where: { conversationId: conv.id }, orderBy: { id: 'asc' } })
  const actionIds = rows.filter(r => r.role === 'event').map(r => r.content.actionId)
  const actions = new Map((await prisma.pendingAction.findMany({ where: { id: { in: actionIds } } })).map(a => [a.id, a]))
  const labelOf = (name) => TOOLS.find(t => t.name === name)?.label || name
  // 每轮回答用的模型记在该轮 user 消息上
  const modelIds = [...new Set(rows.filter(r => r.role === 'user' && r.content.modelId).map(r => r.content.modelId))]
  const modelName = new Map((await prisma.llmConfig.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } })).map(m => [m.id, m.name]))
  let turnModel = null
  const out = []
  let cur = null
  const seenEvents = new Set()
  for (const r of rows) {
    const c = r.content
    if (r.role === 'user') {
      cur = null
      turnModel = c.modelId ? { id: c.modelId, name: modelName.get(c.modelId) || '已删除的模型' } : null
      out.push({ id: r.id, role: 'user', text: c.text, createdAt: r.createdAt })
    } else if (r.role === 'assistant') {
      if (!cur) {
        cur = { id: r.id, role: 'assistant', text: '', tools: [], model: turnModel, createdAt: r.createdAt }
        out.push(cur)
      }
      if (c.content) cur.text += (cur.text ? '\n\n' : '') + c.content
      for (const tc of c.tool_calls || []) cur.tools.push({ id: tc.id, name: tc.function.name, label: labelOf(tc.function.name), ok: true })
    } else if (r.role === 'tool') {
      const t = cur?.tools.find(x => x.id === c.tool_call_id)
      if (t && /^(执行失败|错误|参数有误)/.test(c.content || '')) t.ok = false
    } else if (r.role === 'event') {
      // 同一个确认卡片只展示一次(生成时一条, 确认/取消时再记一条), 状态以 PendingAction 为准
      if (seenEvents.has(c.actionId)) continue
      seenEvents.add(c.actionId)
      const a = actions.get(c.actionId)
      if (!a) continue
      const last = [...rows].reverse().find(x => x.role === 'event' && x.content.actionId === a.id && x.content.resultMessage)
      out.push({
        id: r.id, role: 'event', createdAt: r.createdAt,
        action: {
          id: a.id, toolName: a.toolName, label: labelOf(a.toolName), summary: a.summary,
          status: a.status === 'PENDING' && a.expiresAt < new Date() ? 'EXPIRED' : a.status,
          resultMessage: last?.content.resultMessage || null
        }
      })
      cur = null
    }
  }
  return out
}

// ---------- OpenHex ----------

const ohClients = new Map() // `${modelId}:${updatedAt}` -> client

/** OpenHex SDK 是可选依赖（npm ci --omit=optional 构建时不装），没装时给能看懂的提示 */
async function openhexSdk() {
  try { return await import('@openhex-ai/agent-sdk') } catch {
    throw badRequest('这台平台没装 OpenHex SDK（控制台构建时省掉了可选依赖），OpenHex 模型用不了：换一个模型，或重新构建控制台')
  }
}

/** OpenHex 客户端按模型配置缓存(后台改了 Key/Agent 后自动换新) */
async function openhexClient(cfg) {
  if (!cfg.apiKey || !cfg.model) throw badRequest(`OpenHex 模型「${cfg.name}」缺少 API Key 或 Agent ID`)
  const key = `${cfg.id}:${cfg.updatedAt?.getTime?.() || 0}`
  if (!ohClients.has(key)) {
    const { OpenhexClient } = await openhexSdk()
    ohClients.set(key, new OpenhexClient({ apiKey: cfg.apiKey, agentId: cfg.model, ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}) }))
  }
  return ohClients.get(key)
}

async function chatOpenhex(ctx, conv, message, emit, signal, cfg) {
  const { extractText, isTurnComplete } = await openhexSdk()
  const c = await openhexClient(cfg)
  const req = conv.openhexId
    ? { message: String(message), conversationId: conv.openhexId }
    : { message: String(message), targetAgentIds: [cfg.model], source: `yh-conv-${conv.id}` }
  const connector = cfg.extra?.mcpConnector
  if (connector) req.mcpTokens = { [connector]: signToken(ctx.user.id, { via: 'AI' }) }
  const sent = await c.chat.send(req, { signal })
  if (!conv.openhexId && sent.conversationId) {
    await prisma.agentConversation.update({ where: { id: conv.id }, data: { openhexId: String(sent.conversationId) } })
  }
  let text = ''
  for await (const record of c.chat.stream(sent.conversationId, { lastEventId: sent.userEventId, signal })) {
    if (record.sender === 'assistant') {
      const t = extractText(record)
      if (t) { text += t; emit({ type: 'text', delta: t }) }
    }
    if (isTurnComplete(record)) break
  }
  await save(conv.id, 'assistant', { content: text, tool_calls: [] })
}
