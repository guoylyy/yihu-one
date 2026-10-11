// 应用使用数据
// 两个来源: 控制台自己记录(用户从工作台打开应用、完成统一认证), 应用上报(用户在应用里做了什么)
// 用途: 看每个应用有多少人在用、用来干什么, 决定哪些应用值得继续投入; 也是「谁在什么时候做了什么」的追溯
import prisma from '../lib/prisma.js'
import { assertAdmin, isAdmin } from '../lib/auth.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { briefMap } from './users.js'
import { visibleTo, openUrlOf } from './apps.js'

const ACTION = /^[a-z][a-z0-9_.-]{0,49}$/
const MAX_BATCH = 200
const MAX_DETAIL = 2000
const MAX_AGE_DAYS = 7

/** 工作台侧记录(不抛错, 不影响主流程) */
export function track(appId, userId, action, detail) {
  prisma.appUsageEvent.create({
    data: { appId, userId, action, detail: detail ?? undefined, source: 'WORKBENCH' }
  }).catch(e => console.error('[usage]', e.message))
}

/** 用户从工作台打开应用: 记一次 launch, 返回打开地址 */
export async function launch(ctx, appId) {
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null, status: 'ACTIVE' } })
  if (!app || !visibleTo(app, ctx.user)) throw notFound('应用不存在')
  track(app.id, ctx.user.id, 'launch', { via: ctx.via })
  return { url: openUrlOf(app), type: app.type, kind: app.kind }
}

/**
 * 应用上报事件(应用凭证)。body: { events: [{ userId, action, detail?, at? }] } 或单个事件
 * userId = 统一认证拿到的 user.id。返回接收/拒绝条数, 部分非法不影响其他
 */
export async function ingest(app, body) {
  const list = Array.isArray(body?.events) ? body.events : [body]
  if (list.length > MAX_BATCH) throw badRequest(`单次最多 ${MAX_BATCH} 条`)
  const ids = [...new Set(list.map(e => Number(e?.userId)).filter(Boolean))]
  const known = new Set((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(e => e.id))
  const now = Date.now()
  const rows = []
  const rejected = []
  list.forEach((e, i) => {
    const why = !e || typeof e !== 'object' ? '格式不对'
      : !known.has(Number(e.userId)) ? 'userId 不存在(应为统一认证返回的 user.id)'
      : !ACTION.test(String(e.action || '')) ? 'action 需为小写字母开头, 只含 a-z 0-9 _ . -, 最长 50'
      : e.detail !== undefined && JSON.stringify(e.detail).length > MAX_DETAIL ? `detail 超过 ${MAX_DETAIL} 字符`
      : null
    let at = e?.at ? new Date(e.at) : new Date(now)
    if (!why && (Number.isNaN(at.getTime()) || at.getTime() > now + 60_000 || at.getTime() < now - MAX_AGE_DAYS * 86400_000)) {
      at = null
    }
    if (why || !at) { rejected.push({ index: i, reason: why || `at 须在最近 ${MAX_AGE_DAYS} 天内` }); return }
    rows.push({ appId: app.id, userId: Number(e.userId), action: e.action, detail: e.detail ?? undefined, source: 'APP', createdAt: at })
  })
  if (rows.length) await prisma.appUsageEvent.createMany({ data: rows })
  return { accepted: rows.length, rejected }
}

const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 使用统计: 管理员或应用负责人可看 */
export async function stats(ctx, appId, { days = 30 } = {}) {
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null } })
  if (!app) throw notFound('应用不存在')
  if (!isAdmin(ctx.user) && app.ownerId !== ctx.user.id && app.publisherId !== ctx.user.id) throw forbidden('只有管理员、发布者或应用负责人能看使用数据')
  const n = Math.min(180, Math.max(1, Number(days) || 30))
  // 含今天共 n 天
  const from = new Date(Date.now() - (n - 1) * 86400_000)
  from.setHours(0, 0, 0, 0)
  const events = await prisma.appUsageEvent.findMany({
    where: { appId: app.id, createdAt: { gte: from } },
    orderBy: { id: 'desc' }
  })
  const byDay = new Map()
  for (let t = from.getTime(); t <= Date.now(); t += 86400_000) byDay.set(day(new Date(t)), { date: day(new Date(t)), launches: 0, events: 0, users: new Set() })
  const byAction = new Map()
  const byUser = new Map()
  for (const e of events) {
    const d = byDay.get(day(e.createdAt))
    if (d) {
      if (e.action === 'launch') d.launches++
      else if (e.source === 'APP') d.events++
      d.users.add(e.userId)
    }
    byAction.set(e.action, (byAction.get(e.action) || 0) + 1)
    const u = byUser.get(e.userId) || { count: 0, lastAt: e.createdAt }
    u.count++
    byUser.set(e.userId, u)
  }
  const top = [...byUser.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)
  const bm = await briefMap([...top.map(t => t[0]), ...events.slice(0, 30).map(e => e.userId)])
  const llm = await llmPart(app.id, from, [...byDay.values()])
  return {
    app: { id: app.id, code: app.code, name: app.name, type: app.type },
    days: n,
    totals: {
      users: byUser.size,
      launches: events.filter(e => e.action === 'launch').length,
      appEvents: events.filter(e => e.source === 'APP').length
    },
    // 只有 WORKBENCH 来源的 = 应用还没上报使用数据
    reportsUsage: events.some(e => e.source === 'APP'),
    byDay: [...byDay.values()].map(d => ({ date: d.date, launches: d.launches, events: d.events, users: d.users.size })),
    byAction: [...byAction.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    topUsers: top.map(([id, u]) => ({ user: bm.get(id), count: u.count, lastAt: u.lastAt })),
    recent: events.slice(0, 30).map(e => ({ id: e.id, user: bm.get(e.userId), action: e.action, detail: e.detail, source: e.source, createdAt: e.createdAt })),
    llm
  }
}

/** AI 用量聚合(/api/open/llm 调用): 总次数/token/失败、按天、按模型、按人 */
async function llmPart(appId, from, dates) {
  const rows = await prisma.llmUsageEvent.findMany({ where: { appId, createdAt: { gte: from } }, orderBy: { id: 'desc' } })
  const dayMap = new Map(dates.map(d => [d.date, { date: d.date, calls: 0, tokens: 0 }]))
  const modelMap = new Map()
  const userMap = new Map()
  let errors = 0
  for (const r of rows) {
    const d = dayMap.get(day(r.createdAt))
    if (d) { d.calls++; d.tokens += r.totalTokens }
    if (!modelMap.has(r.model)) modelMap.set(r.model, { calls: 0, tokens: 0 })
    const mv = modelMap.get(r.model)
    mv.calls++; mv.tokens += r.totalTokens
    if (r.userId) {
      const uv = userMap.get(r.userId) || { calls: 0, tokens: 0 }
      uv.calls++; uv.tokens += r.totalTokens
      userMap.set(r.userId, uv)
    }
    if (r.status === 'ERROR') errors++
  }
  const topUsers = [...userMap.entries()].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 10)
  const bm = await briefMap(topUsers.map(t => t[0]))
  return {
    totals: { calls: rows.length, tokens: rows.reduce((s, r) => s + r.totalTokens, 0), errors },
    byDay: [...dayMap.values()],
    byModel: [...modelMap.entries()].map(([model, v]) => ({ model, calls: v.calls, tokens: v.tokens })).sort((a, b) => b.tokens - a.tokens),
    topUsers: topUsers.map(([id, v]) => ({ user: bm.get(id), calls: v.calls, tokens: v.tokens }))
  }
}

/** 全部应用的使用概览(管理员): 每个应用近 N 天的使用人数和次数 */
export async function overview(ctx, { days = 30 } = {}) {
  assertAdmin(ctx)
  const n = Math.min(180, Math.max(1, Number(days) || 30))
  const from = new Date(Date.now() - n * 86400_000)
  const [apps, grouped, users] = await Promise.all([
    prisma.app.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true, icon: true, iconColor: true, type: true } }),
    prisma.appUsageEvent.groupBy({ by: ['appId', 'source'], where: { createdAt: { gte: from } }, _count: { _all: true } }),
    prisma.appUsageEvent.findMany({ where: { createdAt: { gte: from } }, distinct: ['appId', 'userId'], select: { appId: true, userId: true } })
  ])
  return apps.map(a => ({
    ...a,
    users: users.filter(u => u.appId === a.id).length,
    workbenchEvents: grouped.find(g => g.appId === a.id && g.source === 'WORKBENCH')?._count._all || 0,
    appEvents: grouped.find(g => g.appId === a.id && g.source === 'APP')?._count._all || 0
  })).sort((x, y) => y.users - x.users)
}
