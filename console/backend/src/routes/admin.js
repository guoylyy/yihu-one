// 管理后台: 概览、应用(登记 + 平台运维)、模型配置、系统设置 / 登录方式、审计日志
import express from 'express'
import prisma from '../lib/prisma.js'
import { assertAdmin, ROLES } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { wrap, badRequest, notFound, paging } from '../lib/http.js'
import * as apps from '../services/apps.js'
import { briefMap } from '../services/users.js'
import * as platform from '../services/platform.js'
import * as upgrade from '../services/upgrade.js'
import * as review from '../services/review.js'
import * as usage from '../services/usage.js'
import * as settings from '../services/settings.js'
import * as notifySvc from '../services/notify.js'
import { sealKey, openKey, complete, embed } from '../agent/llm.js'
import * as spaces from '../services/spaces.js'

const router = express.Router()
router.use((req, res, next) => { try { assertAdmin(req.ctx); next() } catch (e) { next(e) } })

// ---------- 应用 ----------
router.get('/apps', wrap(req => apps.adminList(req.ctx)))
// 空间（多公司 / 客户隔离）
router.get('/spaces', wrap(req => spaces.list(req.ctx)))
router.get('/theme-catalog', wrap(req => spaces.themeCatalog(req.ctx)))
router.post('/spaces', wrap(req => spaces.create(req.ctx, req.body || {})))
router.put('/spaces/:id', wrap(req => spaces.update(req.ctx, req.params.id, req.body || {})))
router.delete('/spaces/:id', wrap(req => spaces.remove(req.ctx, req.params.id)))
router.post('/apps', wrap(req => apps.adminCreate(req.ctx, req.body || {})))
router.put('/apps/:id', wrap(req => apps.adminUpdate(req.ctx, req.params.id, req.body || {})))
router.post('/apps/:id/reset-secret', wrap(req => apps.resetSecret(req.ctx, req.params.id)))
router.delete('/apps/:id', wrap(req => apps.adminDelete(req.ctx, req.params.id)))
router.get('/usage', wrap(req => usage.overview(req.ctx, req.query)))
// 系统设置「发布通知」里的测试按钮
router.post('/notify/test', wrap(req => notifySvc.sendTest(req.ctx)))

// ---------- 平台运维(由宿主机 yh agent 执行) ----------
router.get('/platform', wrap(req => platform.overview(req.ctx)))
router.get('/platform/ops', wrap(req => platform.listOps(req.ctx, req.query)))
router.get('/platform/ops/:id', wrap(req => platform.getOp(req.ctx, req.params.id)))
router.post('/platform/ops', wrap(req => platform.requestOp(req.ctx, req.body || {})))
router.get('/platform/deploys', wrap(req => platform.listDeploys(req.ctx, req.query)))
// 不能联网的机器: 上传更新包(请求体就是文件), 再发起 UPGRADE 操作让 agent 取走安装
router.get('/platform/packages', wrap(req => upgrade.listPackages(req.ctx)))
router.post('/platform/packages', express.raw({ type: 'application/octet-stream', limit: upgrade.PACKAGE_MAX }),
  wrap(req => upgrade.uploadPackage(req.ctx, req.body, { filename: req.query.filename, sig: req.query.sig })))
router.delete('/platform/packages/:id', wrap(req => upgrade.removePackage(req.ctx, req.params.id)))

// ---------- 应用市场：审核、下架、举报 ----------
router.get('/review', wrap(req => review.pending(req.ctx, req.query)))
router.get('/review/:vid', wrap(req => review.detail(req.ctx, req.params.vid)))
router.post('/review/:vid/approve', wrap(req => review.approve(req.ctx, req.params.vid, req.body || {})))
router.post('/review/:vid/reject', wrap(req => review.reject(req.ctx, req.params.vid, req.body || {})))
router.post('/apps/:id/delist', wrap(req => review.delist(req.ctx, req.params.id, req.body || {})))
router.get('/reports', wrap(req => review.reports(req.ctx, req.query)))
router.get('/market/apps', wrap(req => review.allApps(req.ctx, req.query)))
router.post('/reports/:id/resolve', wrap(req => review.resolveReport(req.ctx, req.params.id, req.body || {})))

// ---------- 概览 ----------
router.get('/overview', wrap(async (req) => {
  const since = new Date(Date.now() - 30 * 86400_000)
  const [users, activeUsers, appsCount, managed, models, ops, deploys, usageList] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null, active: true } }),
    prisma.user.count({ where: { deletedAt: null, active: true, lastLoginAt: { gte: since } } }),
    prisma.app.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.app.findMany({ where: { deletedAt: null, managed: true }, select: { code: true, name: true, icon: true, iconColor: true, status: true, runtime: true } }),
    prisma.llmConfig.count({ where: { deletedAt: null, enabled: true } }),
    platform.listOps(req.ctx, { limit: 8 }),
    platform.listDeploys(req.ctx, { limit: 8 }),
    usage.overview(req.ctx, { days: 30 })
  ])
  return {
    users, activeUsers, apps: appsCount, models,
    // 登录方式页保存过一次就算配置过(默认的账号密码登录本身就能用)
    loginConfigured: !!(await prisma.systemSetting.findUnique({ where: { key: 'login' } })),
    reviewPending: await prisma.appVersion.count({ where: { status: 'PENDING', app: { deletedAt: null } } }),
    reportsOpen: await prisma.appReport.count({ where: { status: 'OPEN' } }),
    managed: managed.map(a => ({ ...a, healthy: a.runtime?.health === 'ok' })),
    platform: await platform.overview(req.ctx),
    recentOps: ops, recentDeploys: deploys,
    topApps: usageList.filter(a => a.users || a.workbenchEvents).slice(0, 8)
  }
}))

// ---------- 模型配置 ----------
// 用户对话时可在「允许用户选择」的模型里挑; OPENHEX 类型: model = Agent ID, extra.mcpConnector = 连接器 slug
const mask = (k) => (k ? `${k.slice(0, 4)}****${k.slice(-4)}` : '')
const llmDto = (r) => ({ ...r, kind: r.kind || 'CHAT', apiKey: mask(openKey(r.apiKey)) })
const PROVIDERS = new Set(['OPENAI_COMPAT', 'ANTHROPIC', 'OPENHEX'])
const ROLE_SET = new Set(ROLES)

function llmData(b, isCreate) {
  const d = {}
  for (const k of ['name', 'baseUrl', 'model', 'description']) if (b[k] !== undefined) d[k] = b[k] || null
  if (b.provider !== undefined) {
    if (!PROVIDERS.has(b.provider)) throw badRequest('provider 只能是 OPENAI_COMPAT / ANTHROPIC / OPENHEX')
    d.provider = b.provider
  }
  if (b.kind !== undefined) {
    if (!['CHAT', 'EMBEDDING'].includes(b.kind)) throw badRequest('kind 只能是 CHAT / EMBEDDING')
    d.kind = b.kind
  }
  if (d.kind === 'EMBEDDING') { d.isDefault = false; d.selectable = false; d.roles = null } // 向量模型不进选择器、不作默认
  if (b.apiKey) d.apiKey = sealKey(b.apiKey)
  if (b.maxTokens !== undefined) d.maxTokens = Number(b.maxTokens) || 4096
  if (b.isDefault !== undefined) d.isDefault = !!b.isDefault
  if (b.enabled !== undefined) d.enabled = !!b.enabled
  if (b.selectable !== undefined) d.selectable = !!b.selectable
  if (b.sort !== undefined) d.sort = Number(b.sort) || 0
  if (b.extra !== undefined) {
    if (b.extra !== null && typeof b.extra !== 'object') throw badRequest('extra 必须是对象')
    d.extra = b.extra || null
  }
  if (b.roles !== undefined) {
    if (b.roles !== null && (!Array.isArray(b.roles) || b.roles.some(r => !ROLE_SET.has(r)))) throw badRequest(`roles 只能包含 ${ROLES.join(' / ')}`)
    d.roles = b.roles?.length ? b.roles : null
  }
  if (isCreate && (!d.name || !d.provider || !d.model || !d.apiKey)) throw badRequest('name、provider、model（OpenHex 填 Agent ID）、apiKey 必填')
  return d
}

router.get('/llm-configs', wrap(async () => {
  const rows = await prisma.llmConfig.findMany({ where: { deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { sort: 'asc' }, { id: 'asc' }] })
  return rows.map(llmDto)
}))
router.post('/llm-configs', wrap(async (req) => {
  const d = llmData(req.body || {}, true)
  const first = !(await prisma.llmConfig.count({ where: { deletedAt: null } }))
  if (d.isDefault || first) { await prisma.llmConfig.updateMany({ data: { isDefault: false } }); d.isDefault = true }
  const r = await prisma.llmConfig.create({ data: d })
  audit(req.ctx, 'llm.create', { entityType: 'llmConfig', entityId: r.id, detail: { name: r.name, provider: r.provider, model: r.model } })
  return llmDto(r)
}))
router.put('/llm-configs/:id', wrap(async (req) => {
  const d = llmData(req.body || {}, false)
  if (d.isDefault) await prisma.llmConfig.updateMany({ data: { isDefault: false } })
  const r = await prisma.llmConfig.update({ where: { id: Number(req.params.id) }, data: d })
  audit(req.ctx, 'llm.update', { entityType: 'llmConfig', entityId: r.id, detail: { ...d, apiKey: d.apiKey ? '(已修改)' : undefined } })
  return llmDto(r)
}))
router.delete('/llm-configs/:id', wrap(async (req) => {
  const r = await prisma.llmConfig.update({ where: { id: Number(req.params.id) }, data: { deletedAt: new Date(), enabled: false, isDefault: false } })
  // 删掉的是默认模型时, 把下一个启用的设为默认, 避免助手突然不可用
  if (!(await prisma.llmConfig.count({ where: { deletedAt: null, isDefault: true } }))) {
    const next = await prisma.llmConfig.findFirst({ where: { deletedAt: null, enabled: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] })
    if (next) await prisma.llmConfig.update({ where: { id: next.id }, data: { isDefault: true } })
  }
  audit(req.ctx, 'llm.delete', { entityType: 'llmConfig', entityId: r.id, detail: { name: r.name } })
  return { ok: true }
}))
// 测试连通: 发一句话, 返回回复和耗时(OpenHex 只校验配置是否齐全)
router.post('/llm-configs/:id/test', wrap(async (req) => {
  const row = await prisma.llmConfig.findFirst({ where: { id: Number(req.params.id), deletedAt: null } })
  if (!row) throw notFound('模型不存在')
  const cfg = { ...row, apiKey: openKey(row.apiKey) }
  const started = Date.now()
  if (cfg.provider === 'OPENHEX') {
    return { ok: !!(cfg.apiKey && cfg.model), message: cfg.apiKey && cfg.model ? '配置齐全（OpenHex 需在对话里实测）' : '缺少 API Key 或 Agent ID', ms: 0 }
  }
  try {
    if ((row.kind || 'CHAT') === 'EMBEDDING') {
      const [v] = await embed(['连通性测试'], { modelId: row.id })
      const dims = Array.isArray(v) ? v.length : 0
      return dims ? { ok: true, message: `向量模型连接正常，返回 ${dims} 维`, ms: Date.now() - started } : { ok: false, message: '接口通了但没有返回向量，检查模型名是否为向量模型', ms: Date.now() - started }
    }
    const r = await complete({ ...cfg, maxTokens: 50 }, { system: '你是连通性测试，只回复「连接正常」四个字。', messages: [{ role: 'user', content: '测试' }] })
    return { ok: true, message: r.content.slice(0, 100) || '(空回复)', ms: Date.now() - started }
  } catch (e) {
    return { ok: false, message: e.message.slice(0, 300), ms: Date.now() - started }
  }
}))

// ---------- 系统设置 ----------
router.get('/settings', wrap(req => settings.listForAdmin(req.ctx, req.query.page)))
router.put('/settings/:group', wrap(req => settings.update(req.ctx, req.params.group, req.body || {})))

// ---------- 审计 ----------
router.get('/audit', wrap(async (req) => {
  const { skip, take } = paging(req.query)
  const where = {}
  if (req.query.actorId) where.actorId = Number(req.query.actorId)
  if (req.query.via) where.via = req.query.via
  if (req.query.action) where.action = { contains: req.query.action }
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
    prisma.auditLog.count({ where })
  ])
  const bm = await briefMap(rows.map(r => r.actorId))
  return {
    list: rows.map(r => ({ id: r.id, actor: r.actorId ? bm.get(r.actorId) || null : null, via: r.via, action: r.action, entityType: r.entityType, entityId: r.entityId, detail: r.detail, createdAt: r.createdAt })),
    total
  }
}))

export default router
