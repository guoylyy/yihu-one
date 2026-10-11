// 应用市场：浏览、详情、评分评论、举报
// 能看到什么由 apps.visibleTo 决定：上架的（按可见范围）+ 分享给我的 + 我自己发布的
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { isAdmin } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/http.js'
import { visibleTo, openUrlOf, MARKET_LISTABLE } from './apps.js'
import { briefMap } from './users.js'

const KIND_LABEL = { AGENT: 'AI 助手', LITE: '轻应用', EXTERNAL: '外部应用', HOSTED: '代码应用', SKILL: 'Skill' }

async function stats(appIds) {
  const [installs, ratings] = await Promise.all([
    prisma.userApp.groupBy({ by: ['appId'], where: { appId: { in: appIds } }, _count: { _all: true } }),
    prisma.appRating.groupBy({ by: ['appId'], where: { appId: { in: appIds } }, _avg: { stars: true }, _count: { _all: true } })
  ])
  const m = new Map(appIds.map(id => [id, { installs: 0, rating: null, ratingCount: 0 }]))
  installs.forEach(r => { m.get(r.appId).installs = r._count._all })
  ratings.forEach(r => Object.assign(m.get(r.appId), { rating: r._avg.stars ? Math.round(r._avg.stars * 10) / 10 : null, ratingCount: r._count._all }))
  return m
}

function cardDto(a, s, installed, publishers) {
  return {
    id: a.id, code: a.code, kind: a.kind, kindLabel: KIND_LABEL[a.kind], name: a.name, icon: a.icon, iconColor: a.iconColor,
    description: a.description, category: a.category, tags: a.tags || [], scope: a.scope, listed: a.listed,
    url: openUrlOf(a), hasMcp: !!a.mcpUrl, installed, publisher: publishers.get(a.publisherId) || null,
    installs: s.installs, rating: s.rating, ratingCount: s.ratingCount, updatedAt: a.updatedAt
  }
}

/**
 * 市场列表。q 搜索；kind / category 筛选；sort: hot 最多人用 / new 最新 / rating 评分
 * 返回 { apps, categories }。apps 里含「分享给我的」和「我发布的」（scope 字段区分）
 */
export async function list(ctx, { q, kind, category, sort = 'hot' } = {}) {
  const rows = await prisma.app.findMany({ where: { deletedAt: null, status: 'ACTIVE', ...MARKET_LISTABLE }, orderBy: { id: 'asc' } })
  let apps = rows.filter(a => visibleTo(a, ctx.user))
  const categories = [...new Set(apps.map(a => a.category).filter(Boolean))]
  if (kind) apps = apps.filter(a => a.kind === kind)
  if (category) apps = apps.filter(a => a.category === category)
  if (q) {
    const k = String(q).toLowerCase()
    apps = apps.filter(a => [a.name, a.description, a.code, a.category, ...(a.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(k))
  }
  const [s, mine, publishers] = await Promise.all([
    stats(apps.map(a => a.id)),
    prisma.userApp.findMany({ where: { userId: ctx.user.id }, select: { appId: true } }),
    briefMap(apps.map(a => a.publisherId))
  ])
  const installed = new Set(mine.map(m => m.appId))
  const out = apps.map(a => cardDto(a, s.get(a.id), installed.has(a.id), publishers))
  const by = {
    hot: (x, y) => y.installs - x.installs || (y.rating || 0) - (x.rating || 0),
    new: (x, y) => new Date(y.updatedAt) - new Date(x.updatedAt),
    rating: (x, y) => (y.rating || 0) - (x.rating || 0) || y.ratingCount - x.ratingCount
  }
  out.sort(by[sort] || by.hot)
  return { apps: out, categories }
}

export async function detail(ctx, id) {
  const app = await prisma.app.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!app || (!visibleTo(app, ctx.user) && !isAdmin(ctx.user))) throw notFound('应用不存在或你没有权限查看')
  const [s, mineInstall, ratings, myRating, versions] = await Promise.all([
    stats([app.id]),
    prisma.userApp.findUnique({ where: { userId_appId: { userId: ctx.user.id, appId: app.id } } }),
    prisma.appRating.findMany({ where: { appId: app.id }, orderBy: { updatedAt: 'desc' }, take: 30 }),
    prisma.appRating.findUnique({ where: { appId_userId: { appId: app.id, userId: ctx.user.id } } }),
    prisma.appVersion.findMany({ where: { appId: app.id, status: { in: ['APPROVED', 'SUPERSEDED'] } }, orderBy: { id: 'desc' }, take: 20 })
  ])
  const bm = await briefMap([app.publisherId, ...ratings.map(r => r.userId)])
  const live = versions.find(v => v.id === app.liveVersionId)
  return {
    ...cardDto(app, s.get(app.id), !!mineInstall, bm),
    intro: app.intro, screenshots: app.screenshots || [],
    usable: !!openUrlOf(app) && app.status === 'ACTIVE' && (app.kind === 'EXTERNAL' || app.kind === 'HOSTED' ? !!app.url : !!app.liveVersionId),
    isPublisher: app.publisherId === ctx.user.id,
    permissions: describePermissions(app, live),
    versions: versions.map(v => ({ id: v.id, version: v.version, changelog: v.changelog, date: v.reviewedAt || v.updatedAt })),
    ratings: ratings.map(r => ({ user: bm.get(r.userId) || null, stars: r.stars, comment: r.comment, updatedAt: r.updatedAt })),
    myRating: myRating ? { stars: myRating.stars, comment: myRating.comment } : null
  }
}

/** 给用户看的「这个应用能做什么 / 会拿到什么」 */
export function describePermissions(app, liveVersion) {
  const out = []
  const p = app.permissions || {}
  if (app.kind === 'SKILL') {
    const n = liveVersion?.payload?.files?.length || 0
    out.push(`包含 ${n} 个文件，下载到你自己的 Agent（Claude Code、Codex 等）里使用`)
    out.push('平台只保存和分发，不执行它；用之前先看一眼 SKILL.md 和里面的脚本')
  } else if (app.kind === 'AGENT') {
    const tools = liveVersion?.payload?.tools || []
    out.push(tools.length ? `调用 ${tools.length} 个工具（以你自己的权限执行，写操作会先让你确认）` : '只对话，不调用任何工具')
  } else if (app.kind === 'LITE') {
    out.push('在平台上保存它自己的数据（只有这个应用能读写）')
    if (p.ai) out.push('调用 AI 模型（按人每天限额）')
    if (p.tools?.length) out.push(`调用 ${p.tools.length} 个只读工具（以你自己的权限执行）`)
  } else {
    out.push('用你的平台身份登录（姓名、账号、角色）')
    if (app.trusted || p.scopes?.includes('org')) out.push('读取你的部门、职位、工号')
    if (app.trusted || p.scopes?.includes('contact')) out.push('读取你的手机号、邮箱')
    if (app.mcpUrl) out.push('提供工具给 AI 助手（以你自己的权限执行）')
  }
  return out
}

export async function rate(ctx, id, { stars, comment }) {
  const app = await prisma.app.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!app || !visibleTo(app, ctx.user)) throw notFound('应用不存在')
  if (app.publisherId === ctx.user.id) throw badRequest('不能给自己的应用打分')
  const n = Number(stars)
  if (!Number.isInteger(n) || n < 1 || n > 5) throw badRequest('评分为 1~5 星')
  const text = comment ? String(comment).trim().slice(0, 1000) : null
  await prisma.appRating.upsert({
    where: { appId_userId: { appId: app.id, userId: ctx.user.id } },
    create: { appId: app.id, userId: ctx.user.id, stars: n, comment: text },
    update: { stars: n, comment: text }
  })
  audit(ctx, 'market.rate', { entityType: 'app', entityId: app.id, detail: { stars: n } })
  return { ok: true }
}

export async function report(ctx, id, { reason }) {
  const app = await prisma.app.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!app || !visibleTo(app, ctx.user)) throw notFound('应用不存在')
  const text = String(reason || '').trim()
  if (text.length < 4) throw badRequest('请写清楚哪里有问题')
  const r = await prisma.appReport.create({ data: { appId: app.id, userId: ctx.user.id, reason: text.slice(0, 1000) } })
  audit(ctx, 'market.report', { entityType: 'app', entityId: app.id, detail: { reportId: r.id } })
  return { ok: true }
}
