// 创作中心：员工自己建应用、存草稿、发版本
// 四种应用（App.kind）：
//   AGENT    AI 助手：提示词 + 挑选工具 + 模型，所有员工都能建
//   LITE     轻应用：AI 生成的单页面，跑在沙箱里，数据存在平台（见 lite.js），所有员工都能建
//   EXTERNAL 外部应用：已有系统的地址 + 统一登录 + MCP，所有员工都能登记
//   HOSTED   托管应用：Git 仓库跑在平台容器里，只有管理员和开发者能提交
// 发布范围（targetScope）决定要不要审核：
//   PRIVATE 仅自己 → 直接生效；SHARED 分享给指定人/部门 → AI 助手和轻应用直接生效，其余要审核；MARKET 上架全公司 → 一律审核
//   托管应用不管什么范围都要审核（陌生代码要跑在平台机器上）
import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { isAdmin, isDeveloper, sha256 } from '../lib/auth.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { validIcon, validColor } from '../lib/icon.js'
import { get as getSetting } from './settings.js'
import { newSecret } from './apps.js'
import { briefMap } from './users.js'
import { checkCode, requestOp } from './platform.js'
import { normalizeSkillPayload } from './skills.js'

export const KINDS = ['AGENT', 'LITE', 'EXTERNAL', 'HOSTED', 'SKILL']
export const SCOPES = ['PRIVATE', 'SHARED', 'MARKET']
const KIND_LABEL = { AGENT: 'AI 助手', LITE: '轻应用', EXTERNAL: '外部应用', HOSTED: '代码应用', SKILL: 'Skill' }
const LITE_MAX = 400_000
const OPEN_STATUSES = ['DRAFT', 'PENDING']

const isUrl = (s) => typeof s === 'string' && /^https?:\/\/\S+$/.test(s)
const str = (v, max, label) => {
  const s = v == null ? '' : String(v).trim()
  if (s.length > max) throw badRequest(`${label}最多 ${max} 个字`)
  return s
}

// ---------- 内容校验（每种应用的 payload） ----------

export function defaultPayload(kind) {
  if (kind === 'AGENT') return { prompt: '', tools: [], modelId: null, starters: [], greeting: '' }
  if (kind === 'LITE') return { html: '', chat: [] }
  if (kind === 'EXTERNAL') return { url: '', redirectUris: [], mcpUrl: '' }
  if (kind === 'SKILL') return { name: '', description: '', version: '', files: [], digest: '' }
  return { git: '', branch: '' }
}

/** 规范化并校验内容。strict=true 用于提交（必填项要齐），false 用于存草稿 */
export function normalizePayload(kind, p = {}, strict = false) {
  if (kind === 'SKILL') return normalizeSkillPayload(p, strict)
  if (kind === 'AGENT') {
    const out = {
      prompt: str(p.prompt, 8000, '提示词'),
      tools: [...new Set((Array.isArray(p.tools) ? p.tools : []).map(String).filter(Boolean))].slice(0, 60),
      allReadOnly: !!p.allReadOnly,
      modelId: p.modelId ? Number(p.modelId) : null,
      starters: (Array.isArray(p.starters) ? p.starters : []).map(s => str(s, 100, '开场问题')).filter(Boolean).slice(0, 6),
      greeting: str(p.greeting, 500, '欢迎语')
    }
    if (strict && !out.prompt) throw badRequest('请填写提示词：告诉助手它是谁、帮用户做什么、有什么规矩')
    return out
  }
  if (kind === 'LITE') {
    const html = typeof p.html === 'string' ? p.html : ''
    if (html.length > LITE_MAX) throw badRequest('页面太大（超过 400KB），请精简')
    if (strict && !html.trim()) throw badRequest('还没有页面：先在左边描述需求让 AI 生成')
    const chat = (Array.isArray(p.chat) ? p.chat : []).slice(-20).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content || '').slice(0, 4000) }))
    return { html, chat }
  }
  if (kind === 'EXTERNAL') {
    const out = {
      url: str(p.url, 500, '地址'),
      redirectUris: (Array.isArray(p.redirectUris) ? p.redirectUris : []).map(s => str(s, 500, '回调地址')).filter(Boolean).slice(0, 10),
      mcpUrl: str(p.mcpUrl, 500, 'MCP 地址')
    }
    if (strict && !isUrl(out.url)) throw badRequest('请填写应用地址（http:// 或 https:// 开头）')
    if (out.redirectUris.some(u => !isUrl(u))) throw badRequest('回调地址要以 http:// 或 https:// 开头')
    if (out.mcpUrl && !isUrl(out.mcpUrl)) throw badRequest('MCP 地址要以 http:// 或 https:// 开头')
    return out
  }
  const out = { git: str(p.git, 500, '仓库地址'), branch: str(p.branch, 100, '分支') }
  if (strict && !/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)\S+$/.test(out.git)) throw badRequest('请填写 Git 仓库地址（https://、git@、ssh:// 或 git:// 开头）')
  if (out.branch && !/^[\w./-]{1,100}$/.test(out.branch)) throw badRequest('分支名不合法')
  return out
}

/** 声明的权限：轻应用 { ai, tools[] }；外部 / 托管应用 { scopes[] }（统一登录能拿到哪些用户信息） */
export function normalizePermissions(kind, p = {}) {
  if (kind === 'LITE') return { ai: !!p?.ai, tools: [...new Set((Array.isArray(p?.tools) ? p.tools : []).map(String))].slice(0, 30) }
  if (kind === 'EXTERNAL' || kind === 'HOSTED') {
    const scopes = (Array.isArray(p?.scopes) ? p.scopes : []).filter(s => ['org', 'contact'].includes(s))
    return { scopes: [...new Set(scopes)] }
  }
  return null
}

function needsReview(kind, scope) {
  if (kind === 'HOSTED') return true
  if (scope === 'MARKET') return true
  if (scope === 'SHARED') return kind === 'EXTERNAL'
  return false
}

function normalizeVisibility(scope, v) {
  if (scope === 'PRIVATE') return null
  const out = {
    deptIds: (v?.deptIds || []).map(Number).filter(Boolean),
    userIds: (v?.userIds || []).map(Number).filter(Boolean),
    roles: (v?.roles || []).filter(r => ['ADMIN', 'DEVELOPER', 'MEMBER'].includes(r))
  }
  const empty = !out.deptIds.length && !out.userIds.length && !out.roles.length
  if (scope === 'SHARED' && empty) throw badRequest('分享给谁？请选择同事或部门')
  return empty ? null : out
}

// ---------- 查询 ----------

async function ownApp(ctx, id, { allowAdmin = true } = {}) {
  const app = await prisma.app.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!app) throw notFound('应用不存在')
  if (app.publisherId !== ctx.user.id && !(allowAdmin && isAdmin(ctx.user))) throw forbidden('只有发布者能修改这个应用')
  return app
}

function versionDto(v, bm = new Map(), withPayload = false) {
  return {
    id: v.id, version: v.version, changelog: v.changelog, status: v.status,
    targetScope: v.targetScope, targetVisibility: v.targetVisibility, permissions: v.permissions,
    submittedAt: v.submittedAt, reviewedAt: v.reviewedAt, reviewNote: v.reviewNote,
    reviewer: v.reviewedBy ? bm.get(v.reviewedBy) || null : null,
    createdAt: v.createdAt, updatedAt: v.updatedAt,
    ...(withPayload ? { payload: v.payload } : {})
  }
}

export function studioAppDto(a, extra = {}) {
  return {
    id: a.id, code: a.code, kind: a.kind, kindLabel: KIND_LABEL[a.kind], name: a.name, icon: a.icon, iconColor: a.iconColor,
    description: a.description, intro: a.intro, category: a.category, tags: a.tags || [], screenshots: a.screenshots || [],
    scope: a.scope, listed: a.listed, visibility: a.visibility, status: a.status, liveVersionId: a.liveVersionId,
    managed: a.managed, url: a.url, hasSecret: !!a.clientSecretHash, adminNote: a.adminNote,
    permissions: a.permissions, createdAt: a.createdAt, updatedAt: a.updatedAt, ...extra
  }
}

export async function listMine(ctx) {
  const apps = await prisma.app.findMany({
    where: { publisherId: ctx.user.id, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: { versions: { orderBy: { id: 'desc' }, take: 1 }, _count: { select: { users: true } } }
  })
  // 近 30 天多少人用过：长期没人用的提示发布者归档
  const since = new Date(Date.now() - 30 * 86400_000)
  const used = await prisma.appUsageEvent.findMany({ where: { appId: { in: apps.map(a => a.id) }, createdAt: { gte: since } }, distinct: ['appId', 'userId'], select: { appId: true } })
  const users30 = new Map()
  used.forEach(u => users30.set(u.appId, (users30.get(u.appId) || 0) + 1))
  return apps.map(a => studioAppDto(a, {
    latest: a.versions[0] ? versionDto(a.versions[0]) : null,
    installs: a._count.users,
    users30: users30.get(a.id) || 0,
    idle: !!a.liveVersionId && a.scope !== 'PRIVATE' && !users30.get(a.id) && Date.now() - new Date(a.updatedAt) > 30 * 86400_000
  }))
}

export async function getMine(ctx, id) {
  const app = await ownApp(ctx, id)
  const versions = await prisma.appVersion.findMany({ where: { appId: app.id }, orderBy: { id: 'desc' }, take: 50 })
  const bm = await briefMap(versions.map(v => v.reviewedBy))
  const draft = versions.find(v => v.status === 'DRAFT') || null
  const pending = versions.find(v => v.status === 'PENDING') || null
  const live = app.liveVersionId ? await prisma.appVersion.findUnique({ where: { id: app.liveVersionId } }) : null
  // 被打回 / 撤回、比生效版本新的：编辑器里接着改它
  const unpublished = versions.find(v => ['REJECTED', 'WITHDRAWN'].includes(v.status) && v.id > (app.liveVersionId || 0)) || null
  return studioAppDto(app, {
    // 管理员能看别人的应用（只读），只有发布者能改
    readonly: app.publisherId !== ctx.user.id,
    installs: await prisma.userApp.count({ where: { appId: app.id } }),
    // 编辑器打开的内容：草稿 > 待审核 > 被打回的 > 生效版本 > 默认
    working: versionDto(draft || pending || unpublished || live || { id: null, status: 'NEW', payload: defaultPayload(app.kind), permissions: null, targetScope: app.scope }, bm, true),
    live: live ? versionDto(live, bm) : null,
    pending: pending ? versionDto(pending, bm) : null,
    versions: versions.map(v => versionDto(v, bm))
  })
}

// ---------- 建应用 ----------

const randCode = (prefix) => `${prefix}-${crypto.randomBytes(3).toString('hex')}`

export async function createApp(ctx, b) {
  const kind = String(b.kind || '')
  if (!KINDS.includes(kind)) throw badRequest('请选择应用类型')
  const market = await getSetting('market')
  if (!market.publishEnabled && !isAdmin(ctx.user)) throw forbidden('管理员暂时关闭了员工发布应用')
  if (kind === 'HOSTED' && !isDeveloper(ctx.user)) throw forbidden('代码应用只有管理员和开发者能提交；普通员工可以做 AI 助手或轻应用')
  const limitKey = { AGENT: 'agentsPerUser', LITE: 'litesPerUser', HOSTED: 'hostedPerDeveloper', SKILL: 'skillsPerUser' }[kind]
  if (limitKey && !isAdmin(ctx.user)) {
    const mine = await prisma.app.count({ where: { publisherId: ctx.user.id, kind, deletedAt: null } })
    if (mine >= market[limitKey]) throw badRequest(`你已经有 ${mine} 个${KIND_LABEL[kind]}，到上限了（${market[limitKey]}）。先删掉不用的，或找管理员调整`)
  }
  const name = str(b.name, 60, '名称')
  if (!name) throw badRequest('请填写应用名称')
  let code
  if (kind === 'EXTERNAL' || kind === 'HOSTED') {
    code = String(b.code || '').trim()
    checkCode(code)
    if (await prisma.app.findUnique({ where: { code } })) throw badRequest(`code ${code} 已被占用`)
  } else {
    do { code = randCode({ AGENT: 'agent', LITE: 'lite', SKILL: 'skill' }[kind]) } while (await prisma.app.findUnique({ where: { code } }))
  }
  const app = await prisma.app.create({
    data: {
      code, name, kind, publisherId: ctx.user.id, ownerId: ctx.user.id,
      spaceId: ctx.user.spaceId || 1, // 发布者所在的空间；要给别的空间用，由管理员分享
      icon: validIcon(b.icon) || ({ AGENT: '✦', LITE: '⚡', SKILL: '📘' }[kind] || '🧩'),
      iconColor: validColor(b.iconColor),
      description: str(b.description, 200, '简介') || null,
      category: str(b.category, 30, '分类') || null,
      type: ['AGENT', 'LITE', 'SKILL'].includes(kind) ? 'NONE' : 'SSO',
      scope: 'PRIVATE', listed: false, status: 'ACTIVE'
    }
  })
  await prisma.appVersion.create({
    data: { appId: app.id, version: 'v1', payload: defaultPayload(kind), targetScope: 'PRIVATE', status: 'DRAFT', createdBy: ctx.user.id }
  })
  audit(ctx, 'studio.app.create', { entityType: 'app', entityId: app.id, detail: { code, kind, name } })
  return getMine(ctx, app.id)
}

/** 上架信息：名称、图标、简介、介绍、分类、标签、截图。改了立即生效（管理员可随时下架） */
export async function updateListing(ctx, id, b) {
  const app = await ownApp(ctx, id, { allowAdmin: false })
  const d = {}
  if (b.name !== undefined) { d.name = str(b.name, 60, '名称'); if (!d.name) throw badRequest('名称不能为空') }
  if (b.icon !== undefined) d.icon = validIcon(b.icon)
  if (b.iconColor !== undefined) d.iconColor = validColor(b.iconColor)
  // 代码应用：在这里换过图标，之后发布就不再用 yh-app.json 的图标覆盖
  if ((b.icon !== undefined || b.iconColor !== undefined) && app.kind === 'HOSTED') d.iconCustom = true
  if (b.description !== undefined) d.description = str(b.description, 200, '简介') || null
  if (b.intro !== undefined) d.intro = str(b.intro, 20000, '详细介绍') || null
  if (b.category !== undefined) d.category = str(b.category, 30, '分类') || null
  if (b.tags !== undefined) d.tags = (Array.isArray(b.tags) ? b.tags : []).map(t => str(t, 20, '标签')).filter(Boolean).slice(0, 8)
  if (b.screenshots !== undefined) {
    const shots = (Array.isArray(b.screenshots) ? b.screenshots : []).slice(0, 6)
    for (const s of shots) {
      if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(s) && !isUrl(s)) throw badRequest('截图须为 PNG / JPG / WebP / GIF 图片')
      if (s.length > 700_000) throw badRequest('单张截图请压缩到 500KB 以内')
    }
    d.screenshots = shots
  }
  await prisma.app.update({ where: { id: app.id }, data: d })
  audit(ctx, 'studio.app.listing', { entityType: 'app', entityId: app.id, detail: { ...d, screenshots: d.screenshots ? `${d.screenshots.length} 张` : undefined, intro: d.intro ? '(已修改)' : undefined } })
  return getMine(ctx, app.id)
}

// ---------- 草稿与版本 ----------

/** 取（或建）可编辑的草稿 */
export async function ensureDraft(ctx, app) {
  const draft = await prisma.appVersion.findFirst({ where: { appId: app.id, status: 'DRAFT' }, orderBy: { id: 'desc' } })
  if (draft) return draft
  // 基于最近一次还没生效的改动（待审核 / 被打回 / 撤回的，比生效版本新）接着改，别把发布者的修改丢了；没有就基于生效版本
  const base = (await prisma.appVersion.findFirst({
    where: { appId: app.id, status: { in: ['PENDING', 'REJECTED', 'WITHDRAWN'] }, id: { gt: app.liveVersionId || 0 } },
    orderBy: { id: 'desc' }
  })) || (app.liveVersionId ? await prisma.appVersion.findUnique({ where: { id: app.liveVersionId } }) : null)
  const count = await prisma.appVersion.count({ where: { appId: app.id } })
  return prisma.appVersion.create({
    data: {
      appId: app.id, version: `v${count + 1}`, status: 'DRAFT', createdBy: ctx.user.id,
      payload: base?.payload ?? defaultPayload(app.kind), permissions: base?.permissions ?? null,
      targetScope: base?.targetScope || app.scope, targetVisibility: base?.targetVisibility ?? app.visibility ?? undefined
    }
  })
}

export async function saveDraft(ctx, id, b) {
  const app = await ownApp(ctx, id, { allowAdmin: false })
  const draft = await ensureDraft(ctx, app)
  const data = {}
  if (b.payload !== undefined) data.payload = normalizePayload(app.kind, { ...draft.payload, ...b.payload })
  if (b.permissions !== undefined) data.permissions = normalizePermissions(app.kind, b.permissions)
  const v = await prisma.appVersion.update({ where: { id: draft.id }, data })
  return versionDto(v, new Map(), true)
}

/** 把某个历史版本的内容拷成新草稿（回退） */
export async function restoreVersion(ctx, id, versionId) {
  const app = await ownApp(ctx, id, { allowAdmin: false })
  const src = await prisma.appVersion.findFirst({ where: { id: Number(versionId), appId: app.id } })
  if (!src) throw notFound('版本不存在')
  const draft = await ensureDraft(ctx, app)
  await prisma.appVersion.update({ where: { id: draft.id }, data: { payload: src.payload, permissions: src.permissions } })
  audit(ctx, 'studio.version.restore', { entityType: 'app', entityId: app.id, detail: { from: src.version } })
  return getMine(ctx, app.id)
}

/**
 * 提交草稿。body: { version?, changelog?, scope, visibility? }
 * 不需要审核的直接生效；需要审核的进入待审核（同一时间只有一个待审核版本）
 */
export async function submit(ctx, id, b) {
  const app = await ownApp(ctx, id, { allowAdmin: false })
  const scope = String(b.scope || app.scope)
  if (!SCOPES.includes(scope)) throw badRequest('发布范围只能是 仅自己 / 分享 / 上架市场')
  // 没有草稿（只改发布范围、内容不变）：从当前生效 / 待审核版本复制一份再提交
  const draft = await ensureDraft(ctx, app)
  const payload = normalizePayload(app.kind, draft.payload, true)
  if (app.kind === 'LITE') payload.chat = draft.payload?.chat || [] // 生成对话留着，方便接着改
  const visibility = normalizeVisibility(scope, b.visibility)
  // Skill 的简介没写过就用 SKILL.md 里的 description
  if (app.kind === 'SKILL' && !app.description && payload.description) {
    app.description = payload.description.slice(0, 200)
    await prisma.app.update({ where: { id: app.id }, data: { description: app.description } })
  }
  if (scope === 'MARKET' && !app.description) throw badRequest('上架前先在「上架信息」里写一句简介')
  const version = str(b.version, 40, '版本号') || draft.version
  const review = needsReview(app.kind, scope)
  await prisma.appVersion.updateMany({ where: { appId: app.id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } })
  let v = await prisma.appVersion.update({
    where: { id: draft.id },
    data: {
      version, changelog: str(b.changelog, 1000, '更新说明') || null, payload,
      // visibility 为 null = 不限范围（上架全员）；必须显式写空，否则会沿用上一版的范围（草稿是从上一版复制的）
      targetScope: scope, targetVisibility: visibility ?? Prisma.DbNull,
      status: review ? 'PENDING' : 'DRAFT', submittedAt: new Date()
    }
  })
  audit(ctx, 'studio.version.submit', { entityType: 'app', entityId: app.id, detail: { version, scope, review } })
  if (!review) v = await publishVersion({ ...ctx, via: ctx.via || 'WEB' }, v.id, { self: true })
  return { status: review ? 'PENDING' : 'APPROVED', version: versionDto(v) }
}

export async function withdraw(ctx, id) {
  const app = await ownApp(ctx, id, { allowAdmin: false })
  const pending = await prisma.appVersion.findFirst({ where: { appId: app.id, status: 'PENDING' } })
  if (!pending) throw badRequest('没有待审核的版本')
  // 撤回后变回草稿，可以接着改；已有草稿时作废成 WITHDRAWN
  const hasDraft = await prisma.appVersion.count({ where: { appId: app.id, status: 'DRAFT' } })
  await prisma.appVersion.update({ where: { id: pending.id }, data: { status: hasDraft ? 'WITHDRAWN' : 'DRAFT', submittedAt: null } })
  audit(ctx, 'studio.version.withdraw', { entityType: 'app', entityId: app.id, detail: { version: pending.version } })
  return getMine(ctx, app.id)
}

/**
 * 让一个版本生效（自动生效或审核通过时调用）
 * - 上一个生效版本标成 SUPERSEDED
 * - 按类型应用内容：外部应用更新地址并在需要时发凭证；托管应用排进运维队列由 yh agent 安装 / 发布
 * - 发布范围和可见范围以这个版本申请的为准
 */
export async function publishVersion(ctx, versionId, { self = false, note = null } = {}) {
  const v = await prisma.appVersion.findUnique({ where: { id: Number(versionId) }, include: { app: true } })
  if (!v) throw notFound('版本不存在')
  if (!self && v.status !== 'PENDING') throw badRequest('这个版本不在待审核状态')
  const app = v.app
  const scope = v.targetScope
  const publisher = app.publisherId ? await prisma.user.findUnique({ where: { id: app.publisherId } }) : null
  const data = {
    scope, listed: scope === 'MARKET', visibility: scope === 'PRIVATE' ? null : (v.targetVisibility ?? null),
    permissions: v.permissions ?? app.permissions ?? null, adminNote: null,
    // 管理员自己发布的应用视为可信（用户打开时不弹授权确认）
    trusted: app.trusted || !!publisher?.roles?.includes('ADMIN')
  }
  if (app.kind === 'AGENT' || app.kind === 'LITE' || app.kind === 'SKILL') data.liveVersionId = v.id
  if (app.kind === 'EXTERNAL') {
    const p = v.payload
    Object.assign(data, {
      url: p.url, redirectUris: p.redirectUris, mcpUrl: p.mcpUrl || null,
      type: p.redirectUris?.length ? 'SSO' : 'LINK', liveVersionId: v.id
    })
    if (p.redirectUris?.length && !app.clientSecretHash) data.clientSecretHash = sha256(newSecret()) // 发布者在创作中心「获取凭证」时重置拿到明文
  }
  if (app.kind === 'HOSTED') data.liveVersionId = v.id
  await prisma.appVersion.updateMany({ where: { appId: app.id, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } })
  const out = await prisma.appVersion.update({
    where: { id: v.id },
    data: { status: 'APPROVED', reviewedBy: self ? null : ctx.user.id, reviewedAt: new Date(), reviewNote: note }
  })
  await prisma.app.update({ where: { id: app.id }, data })
  if (app.kind === 'HOSTED') {
    // 托管应用：审核通过 = 安装（第一次）或按新仓库地址重新发布；由宿主机 yh agent 执行
    const p = v.payload
    await requestOp(ctx, app.managed
      ? { kind: 'DEPLOY', appCode: app.code }
      : { kind: 'INSTALL', appCode: app.code, params: { git: p.git, branch: p.branch || undefined } }, { forPublished: true })
  }
  audit(ctx, self ? 'studio.version.publish' : 'review.approve', { entityType: 'app', entityId: app.id, detail: { version: v.version, scope, note } })
  return out
}

/** 发布者删除自己的应用（托管应用已经装上的，要管理员在「管理 → 应用」里移除） */
export async function removeApp(ctx, id) {
  const app = await ownApp(ctx, id)
  if (app.managed) throw badRequest('代码应用已经装在平台上，请联系管理员在「管理 → 应用」里移除')
  await prisma.app.update({ where: { id: app.id }, data: { deletedAt: new Date(), status: 'DISABLED', listed: false, code: `${app.code}~${app.id}` } })
  await prisma.userApp.deleteMany({ where: { appId: app.id } })
  await prisma.appVersion.updateMany({ where: { appId: app.id, status: { in: OPEN_STATUSES } }, data: { status: 'WITHDRAWN' } })
  audit(ctx, 'studio.app.delete', { entityType: 'app', entityId: app.id, detail: { code: app.code, name: app.name } })
  return { ok: true }
}

/** 外部应用：发布者重置并拿到统一认证凭证（只显示这一次） */
export async function resetSecret(ctx, id) {
  const app = await ownApp(ctx, id, { allowAdmin: false })
  if (app.kind !== 'EXTERNAL' || app.type !== 'SSO') throw badRequest('只有生效了回调地址的外部应用有统一认证凭证')
  const secret = newSecret()
  await prisma.app.update({ where: { id: app.id }, data: { clientSecretHash: sha256(secret) } })
  audit(ctx, 'studio.app.secret', { entityType: 'app', entityId: app.id })
  return { clientId: app.code, clientSecret: secret }
}
