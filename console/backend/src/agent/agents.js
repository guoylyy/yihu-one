// 市场里的 AI 助手（App.kind = AGENT）：发布者写的提示词 + 挑选的工具 + 模型
// 用户装了别人的助手，工具仍然以用户自己的身份和权限执行：助手能用的工具 = 发布者选的 ∩ 这个用户实际能用的
import prisma from '../lib/prisma.js'
import { isAdmin } from '../lib/auth.js'
import { forbidden, notFound } from '../lib/http.js'
import { TOOLS } from '../tools/index.js'
import { loadAppTools } from './appTools.js'
import { visibleTo } from '../services/apps.js'
import { briefMap } from '../services/users.js'

/**
 * 取要对话的助手。versionId 只给发布者（试聊草稿）和管理员（审核时试用）
 * 返回 { app, payload, versionId, publisher } 或 null（默认助手）
 */
export async function resolveAgent(ctx, { appId, versionId } = {}) {
  if (!appId) return null
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null, kind: 'AGENT' } })
  if (!app) throw notFound('这个 AI 助手不存在或已删除')
  let v
  if (versionId) {
    if (app.publisherId !== ctx.user.id && !isAdmin(ctx.user)) throw forbidden('只有发布者和管理员能试用未发布的版本')
    v = await prisma.appVersion.findFirst({ where: { id: Number(versionId), appId: app.id } })
  } else {
    if (!visibleTo(app, ctx.user) || app.status !== 'ACTIVE') throw forbidden('你不能使用这个 AI 助手（可能已下架或没分享给你）')
    v = app.liveVersionId ? await prisma.appVersion.findUnique({ where: { id: app.liveVersionId } }) : null
  }
  if (!v) throw notFound('这个 AI 助手还没有发布')
  const publisher = (await briefMap([app.publisherId])).get(app.publisherId) || null
  return { app, payload: v.payload || {}, versionId: versionId ? v.id : null, publisher }
}

/** 这个用户能用的全部工具（平台通用 + 可见应用的 MCP） */
export async function allToolsFor(user) {
  return [...TOOLS, ...(await loadAppTools(user))]
}

/** 对话用的工具：默认助手按个人偏好去掉关掉的应用；AI 助手按发布者的选择过滤 */
export async function toolsFor(user, agent) {
  const all = await allToolsFor(user)
  if (agent) {
    const want = new Set(agent.payload.tools || [])
    return all.filter(t => want.has(t.name))
  }
  const off = new Set(Array.isArray(user.prefs?.assistantOffApps) ? user.prefs.assistantOffApps : [])
  return off.size ? all.filter(t => !t.appCode || !off.has(t.appCode)) : all
}

export function agentDto(agent) {
  if (!agent) return null
  const p = agent.payload
  return {
    id: agent.app.id, name: agent.app.name, icon: agent.app.icon, iconColor: agent.app.iconColor, description: agent.app.description,
    greeting: p.greeting || '', starters: p.starters || [], toolCount: (p.tools || []).length,
    publisher: agent.publisher, preview: !!agent.versionId
  }
}
