// 轻应用运行时：沙箱页面通过平台 SDK（window.yh）调用的接口
// 页面跑在控制台里的沙箱 iframe（不同源、不能联网），所有能力都经由控制台页面转发到这里，以当前用户身份执行：
//   yh.db    本应用自己的数据（AppData）：私有记录只有自己看得到；共享记录本应用所有用户都看得到，只有创建者和发布者能改
//   yh.ai    调平台模型（要在权限里声明，按人每天限额）
//   yh.tools 调用户本来就能用的只读工具（要在权限里声明）
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { isAdmin } from '../lib/auth.js'
import { badRequest, forbidden, notFound, AppError } from '../lib/http.js'
import { visibleTo } from './apps.js'
import { track } from './usage.js'
import { get as getSetting } from './settings.js'
import { briefMap } from './users.js'
import { allToolsFor } from '../agent/agents.js'
import { runTool } from '../tools/index.js'
import { getLlmConfig, complete } from '../agent/llm.js'

const COLLECTION = /^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/
const RECORD_MAX = 20_000

/**
 * 取轻应用。versionId 只给发布者（预览草稿）和管理员（审核时试用）
 * 预览和正式版共用同一份数据
 */
export async function access(ctx, appId, versionId) {
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null, kind: 'LITE' } })
  if (!app) throw notFound('轻应用不存在或已删除')
  const owner = app.publisherId === ctx.user.id
  let version
  if (versionId) {
    if (!owner && !isAdmin(ctx.user)) throw forbidden('只有发布者和管理员能预览未发布的版本')
    version = await prisma.appVersion.findFirst({ where: { id: Number(versionId), appId: app.id } })
  } else {
    if (!visibleTo(app, ctx.user) || app.status !== 'ACTIVE') throw forbidden('你不能使用这个轻应用（可能已下架或没分享给你）')
    version = app.liveVersionId ? await prisma.appVersion.findUnique({ where: { id: app.liveVersionId } }) : null
  }
  if (!version) throw notFound('这个轻应用还没有发布')
  const permissions = version.permissions || { ai: false, tools: [] }
  return { app, version, permissions, owner, preview: !!versionId }
}

/** 打开轻应用：页面代码 + 当前用户 + 是否需要先授权（P4） */
export async function bootstrap(ctx, appId, versionId) {
  const a = await access(ctx, appId, versionId)
  const grant = await needGrant(ctx, a)
  if (!a.preview && !grant) track(a.app.id, ctx.user.id, 'open')
  const publisher = (await briefMap([a.app.publisherId])).get(a.app.publisherId) || null
  return {
    app: { id: a.app.id, name: a.app.name, icon: a.app.icon, iconColor: a.app.iconColor, description: a.app.description },
    version: a.version.version, preview: a.preview, isPublisher: a.owner, publisher,
    html: grant ? null : a.version.payload?.html || '',
    permissions: a.permissions,
    needGrant: grant,
    user: { id: ctx.user.id, name: ctx.user.name, avatar: ctx.user.avatar, depts: ctx.user.depts }
  }
}

// ---------- 授权（P4）：别人发布的轻应用要用 AI / 工具时，第一次打开先让用户确认 ----------

const grantKey = (p) => JSON.stringify({ ai: !!p?.ai, tools: [...(p?.tools || [])].sort() })

async function needGrant(ctx, a) {
  if (a.owner || a.preview || a.app.trusted) return null
  const p = a.permissions
  if (!p?.ai && !p?.tools?.length) return null
  const g = await prisma.appGrant.findUnique({ where: { userId_appId: { userId: ctx.user.id, appId: a.app.id } } })
  if (g && grantKey(g.permissions) === grantKey(p)) return null
  const labels = new Map((await allToolsFor(ctx.user)).map(t => [t.name, t.label]))
  return {
    ai: !!p.ai,
    tools: (p.tools || []).map(n => ({ name: n, label: labels.get(n) || n, available: labels.has(n) })),
    changed: !!g
  }
}

export async function grant(ctx, appId) {
  const a = await access(ctx, appId)
  await prisma.appGrant.upsert({
    where: { userId_appId: { userId: ctx.user.id, appId: a.app.id } },
    create: { userId: ctx.user.id, appId: a.app.id, permissions: a.permissions },
    update: { permissions: a.permissions, grantedAt: new Date() }
  })
  audit(ctx, 'lite.grant', { entityType: 'app', entityId: a.app.id, detail: a.permissions })
  return { ok: true }
}

async function assertGranted(ctx, a) {
  if (await needGrant(ctx, a)) throw forbidden('请先在页面上确认授权')
}

// ---------- 数据 ----------

function checkCollection(c) {
  if (!COLLECTION.test(c || '')) throw badRequest('数据表名只能用字母开头，字母、数字、_ -，最长 50')
}
function checkData(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw badRequest('data 必须是对象')
  if (JSON.stringify(d).length > RECORD_MAX) throw badRequest('单条记录太大（超过 20KB）')
}

async function recordDtos(ctx, rows) {
  const bm = await briefMap(rows.flatMap(r => [r.ownerId, r.createdBy]))
  return rows.map(r => ({
    id: r.id, data: r.data, shared: r.ownerId == null, mine: r.createdBy === ctx.user.id,
    owner: bm.get(r.createdBy) || null, createdAt: r.createdAt, updatedAt: r.updatedAt
  }))
}

/** 我能看到的：自己的私有记录 + 本应用的共享记录 */
// 能读的：自己空间里、自己的或共享的记录（轻应用分享给多个空间时，各空间的数据互不可见）
const readable = (ctx) => ({ spaceId: ctx.user.spaceId || 1, OR: [{ ownerId: ctx.user.id }, { ownerId: null }] })

export async function list(ctx, appId, collection, q = {}, versionId) {
  const a = await access(ctx, appId, versionId)
  checkCollection(collection)
  const where = { appId: a.app.id, collection, deletedAt: null }
  if (q.scope === 'mine') Object.assign(where, { createdBy: ctx.user.id, spaceId: ctx.user.spaceId || 1 })
  else if (q.scope === 'shared') where.ownerId = null
  else Object.assign(where, readable(ctx))
  // where：数据字段相等过滤，{ "status": "待处理" }，最多 5 个字段
  let filters = {}
  if (q.where) {
    try { filters = typeof q.where === 'string' ? JSON.parse(q.where) : q.where } catch { throw badRequest('where 不是合法 JSON') }
  }
  const and = Object.entries(filters || {}).slice(0, 5).map(([k, v]) => {
    if (!/^[\w-]{1,50}$/.test(k)) throw badRequest(`字段名不合法：${k}`)
    return { data: { path: `$.${k}`, equals: v } }
  })
  if (and.length) where.AND = and
  const order = String(q.order || '-createdAt')
  const field = order.replace(/^-/, '')
  if (!['createdAt', 'updatedAt', 'id'].includes(field)) throw badRequest('order 只能按 createdAt / updatedAt / id 排')
  const take = Math.min(500, Math.max(1, Number(q.limit) || 100))
  const skip = Math.max(0, Number(q.offset) || 0)
  const [rows, total] = await Promise.all([
    prisma.appData.findMany({ where, orderBy: { [field]: order.startsWith('-') ? 'desc' : 'asc' }, take, skip }),
    prisma.appData.count({ where })
  ])
  return { list: await recordDtos(ctx, rows), total }
}

async function findRecord(ctx, a, collection, id) {
  const r = await prisma.appData.findFirst({ where: { id: Number(id), appId: a.app.id, collection, deletedAt: null, ...readable(ctx) } })
  if (!r) throw notFound('记录不存在')
  return r
}

export async function getOne(ctx, appId, collection, id, versionId) {
  const a = await access(ctx, appId, versionId)
  checkCollection(collection)
  return (await recordDtos(ctx, [await findRecord(ctx, a, collection, id)]))[0]
}

export async function create(ctx, appId, collection, { data, shared }, versionId) {
  const a = await access(ctx, appId, versionId)
  checkCollection(collection)
  checkData(data)
  const { liteRowsPerApp } = await getSetting('market')
  if (await prisma.appData.count({ where: { appId: a.app.id, deletedAt: null } }) >= liteRowsPerApp) {
    throw badRequest(`这个轻应用的数据已经到上限（${liteRowsPerApp} 条），请联系发布者清理`)
  }
  const r = await prisma.appData.create({
    data: { appId: a.app.id, spaceId: ctx.user.spaceId || 1, collection, data, ownerId: shared ? null : ctx.user.id, createdBy: ctx.user.id }
  })
  if (!a.preview) track(a.app.id, ctx.user.id, `db.add`, { collection })
  return (await recordDtos(ctx, [r]))[0]
}

function assertWritable(ctx, a, r) {
  if (r.createdBy !== ctx.user.id && !a.owner) throw forbidden('只能修改自己创建的记录')
}

export async function update(ctx, appId, collection, id, { data }, versionId) {
  const a = await access(ctx, appId, versionId)
  checkCollection(collection)
  checkData(data)
  const r = await findRecord(ctx, a, collection, id)
  assertWritable(ctx, a, r)
  const out = await prisma.appData.update({ where: { id: r.id }, data: { data, updatedBy: ctx.user.id } })
  return (await recordDtos(ctx, [out]))[0]
}

export async function remove(ctx, appId, collection, id, versionId) {
  const a = await access(ctx, appId, versionId)
  checkCollection(collection)
  const r = await findRecord(ctx, a, collection, id)
  assertWritable(ctx, a, r)
  await prisma.appData.update({ where: { id: r.id }, data: { deletedAt: new Date(), updatedBy: ctx.user.id } })
  return { ok: true }
}

/** 发布者 / 管理员导出某张数据表（CSV，Excel 可直接打开） */
export async function exportCsv(ctx, appId, collection) {
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null, kind: 'LITE' } })
  if (!app) throw notFound('轻应用不存在')
  if (app.publisherId !== ctx.user.id && !isAdmin(ctx.user)) throw forbidden('只有发布者和管理员能导出数据')
  const where = { appId: app.id, deletedAt: null, ...(collection ? { collection } : {}) }
  const rows = await prisma.appData.findMany({ where, orderBy: { id: 'asc' }, take: 100_000 })
  const bm = await briefMap(rows.map(r => r.createdBy))
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.data || {})))]
  const cell = (v) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [['id', '数据表', '创建人', '共享', '创建时间', '更新时间', ...keys].map(cell).join(',')]
  for (const r of rows) {
    lines.push([r.id, r.collection, bm.get(r.createdBy)?.name || r.createdBy, r.ownerId == null ? '是' : '否', r.createdAt.toISOString(), r.updatedAt.toISOString(), ...keys.map(k => r.data?.[k])].map(cell).join(','))
  }
  audit(ctx, 'lite.export', { entityType: 'app', entityId: app.id, detail: { collection, rows: rows.length } })
  return { filename: `${app.name}-${collection || '全部'}.csv`, csv: '﻿' + lines.join('\r\n') }
}

export async function collections(ctx, appId) {
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null, kind: 'LITE' } })
  if (!app) throw notFound('轻应用不存在')
  if (app.publisherId !== ctx.user.id && !isAdmin(ctx.user)) throw forbidden('只有发布者和管理员能看')
  const rows = await prisma.appData.groupBy({ by: ['collection'], where: { appId: app.id, deletedAt: null }, _count: { _all: true } })
  return rows.map(r => ({ name: r.collection, count: r._count._all }))
}

// ---------- AI 与工具 ----------

export async function ask(ctx, appId, { prompt, system }, versionId) {
  const a = await access(ctx, appId, versionId)
  if (!a.permissions.ai) throw forbidden('这个轻应用没有申请调用 AI 的权限')
  await assertGranted(ctx, a)
  const text = String(prompt || '').trim()
  if (!text) throw badRequest('prompt 不能为空')
  if (text.length > 8000) throw badRequest('prompt 太长（最多 8000 字）')
  const { liteAiPerDay } = await getSetting('market')
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const used = await prisma.appUsageEvent.count({ where: { userId: ctx.user.id, action: 'ai.ask', source: 'LITE', createdAt: { gte: since } } })
  if (used >= liteAiPerDay) throw new AppError(429, `今天轻应用的 AI 调用次数用完了（${liteAiPerDay} 次），明天再试`, 1005)
  const cfg = await getLlmConfig({ user: ctx.user })
  if (!cfg || cfg.provider === 'OPENHEX') throw badRequest('平台还没配置可用的模型')
  const r = await complete({ ...cfg, maxTokens: Math.min(cfg.maxTokens || 2000, 2000) }, {
    system: String(system || '你是一个简洁、准确的助手，用简体中文回答。').slice(0, 2000),
    messages: [{ role: 'user', content: text }]
  })
  await prisma.appUsageEvent.create({ data: { appId: a.app.id, userId: ctx.user.id, action: 'ai.ask', source: 'LITE' } })
  return { text: r.content }
}

export async function callTool(ctx, appId, name, args, versionId) {
  const a = await access(ctx, appId, versionId)
  if (!(a.permissions.tools || []).includes(name)) throw forbidden(`这个轻应用没有申请使用工具 ${name}`)
  await assertGranted(ctx, a)
  const tool = (await allToolsFor(ctx.user)).find(t => t.name === name)
  if (!tool) throw forbidden(`你不能使用工具 ${name}（可能没有对应应用的权限）`)
  if (tool.write) throw forbidden('轻应用只能调用只读工具')
  const appCtx = { ...ctx, via: 'APP' }
  const result = tool.external ? await tool.run(appCtx, args || {}) : await runTool(appCtx, name, args || {})
  if (!a.preview) track(a.app.id, ctx.user.id, 'tool', { name })
  return result
}
