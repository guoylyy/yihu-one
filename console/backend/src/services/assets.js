// 资料中心（REQ-05）：PPT 模板、品牌 VI（Logo、色板、字体、辅助图形）、设计组件等素材。
// 人在「资料」页面预览、下载；Agent 经 MCP 按类别取用（品牌规范给结构化描述 + 文件地址），照公司规范做页面、做 PPT。
// 资料是素材，Skill 是做法：资料可以关联配套的 Skill。问答类的需求用知识库，这里不做通用知识库。
//
// - 资料属于一个空间，这个空间的人都能看（管理员都能看）；管理员建资料、定责任人，责任人和管理员能出新版本
// - 每个版本是一整套文件；文件内容按 sha256 存一份（AssetBlob），新版本没改的文件不重复存。存储和知识库一样放在 MySQL
// - 下载走短期签名地址（不带登录凭证也能用，Agent 拿到就能下）；响应带 CSP sandbox + nosniff，上传的 SVG / HTML 在控制台域名下跑不了脚本
import crypto from 'node:crypto'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { isAdmin } from '../lib/auth.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { DEFAULT_SPACE_ID, assertSpace, spaceBrand } from './spaces.js'
import { resolve as resolveTheme } from './theme.js'
import { briefMap } from './users.js'
import { get as getSetting } from './settings.js'

export const CATEGORIES = { TEMPLATE: '模板', BRAND: '品牌 VI', COMPONENT: '设计组件', OTHER: '其他' }
export const LIMITS = { fileBytes: 50 * 1024 * 1024, files: 30, inlineBytes: 200_000 }
const LINK_TTL_S = 15 * 60
const TEXT_MIME = /^(text\/|application\/(json|xml|javascript))|image\/svg\+xml/
const MIME = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  key: 'application/x-iwork-keynote-sffkey', pdf: 'application/pdf', zip: 'application/zip', fig: 'application/octet-stream', sketch: 'application/octet-stream',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  css: 'text/css', md: 'text/markdown', txt: 'text/plain', json: 'application/json', html: 'text/html'
}
const BLOCKED_EXT = /\.(exe|dll|so|dylib|bin|com|msi|scr|bat|cmd|sh|ps1|app|dmg|pkg|jar)$/i

// ---------- 校验（纯函数，单元测试用） ----------

/** 文件名：去掉路径，只留安全字符；可执行文件直接拒绝 */
export function safeName(name) {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop().replace(/[\u0000-\u001f"<>|:*?]/g, '').trim().slice(0, 200)
  if (!base || base === '.' || base === '..') throw badRequest('文件名不合法')
  if (BLOCKED_EXT.test(base)) throw badRequest(`不能上传可执行文件：${base}`)
  return base
}
export const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'

/** 品牌规范：只留认识的字段、限长；颜色要是 #RRGGBB */
export function normalizeSpec(spec) {
  if (spec == null) return null
  if (typeof spec !== 'object' || Array.isArray(spec)) throw badRequest('spec 要是对象')
  const s = (v, max) => String(v ?? '').trim().slice(0, max)
  const out = {}
  if (Array.isArray(spec.colors)) {
    out.colors = spec.colors.slice(0, 40).map(c => {
      const hex = s(c?.hex, 9).toLowerCase()
      if (!/^#[0-9a-f]{6}$/.test(hex)) throw badRequest(`颜色「${s(c?.name, 40)}」的色值要写成 #RRGGBB`)
      return { name: s(c?.name, 40), hex, usage: s(c?.usage, 200) }
    })
  }
  if (Array.isArray(spec.fonts)) out.fonts = spec.fonts.slice(0, 20).map(f => ({ name: s(f?.name, 60), usage: s(f?.usage, 200), fallback: s(f?.fallback, 200) })).filter(f => f.name)
  if (Array.isArray(spec.rules)) out.rules = spec.rules.slice(0, 50).map(r => s(r, 500)).filter(Boolean)
  if (spec.voice != null) out.voice = s(spec.voice, 2000)
  return Object.keys(out).length ? out : null
}

// ---------- 签名下载地址 ----------

const secret = () => `asset:${process.env.JWT_SECRET || ''}`
export function signFile(fileId, userId, exp = Math.floor(Date.now() / 1000) + LINK_TTL_S) {
  const sig = crypto.createHmac('sha256', secret()).update(`${fileId}.${userId}.${exp}`).digest('base64url').slice(0, 32)
  return { u: userId, exp, sig }
}
export function verifyFile(fileId, { u, exp, sig } = {}) {
  if (!u || !exp || !sig || Number(exp) < Date.now() / 1000) return null
  const want = signFile(fileId, Number(u), Number(exp)).sig
  return want.length === String(sig).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig))) ? Number(u) : null
}
async function fileUrl(fileId, userId) {
  const { publicBaseUrl } = await getSetting('general')
  const q = signFile(fileId, userId)
  return `${String(publicBaseUrl || '').replace(/\/+$/, '')}/api/asset-files/${fileId}?u=${q.u}&exp=${q.exp}&sig=${q.sig}`
}

// ---------- 可见与权限 ----------

const canSee = (user, a) => isAdmin(user) || (a.spaceId ?? DEFAULT_SPACE_ID) === (user.spaceId ?? DEFAULT_SPACE_ID)
const canEdit = (user, a) => isAdmin(user) || (a.ownerId && a.ownerId === user.id)

async function load(ctx, id) {
  const a = await prisma.asset.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!a || !canSee(ctx.user, a)) throw notFound('没有这份资料，或者你没有权限')
  return a
}

async function filesOf(a, version = a.version) {
  return prisma.assetFile.findMany({ where: { assetId: a.id, version }, orderBy: { name: 'asc' } })
}

async function dto(ctx, a, { withFiles = false, owners, uses } = {}) {
  owners ||= await briefMap([a.ownerId])
  const myVersion = uses ? uses.get(a.id) : (await prisma.assetUse.findUnique({ where: { userId_assetId: { userId: ctx.user.id, assetId: a.id } } }))?.version
  const out = {
    id: a.id, category: a.category, categoryLabel: CATEGORIES[a.category], name: a.name, description: a.description, tags: a.tags || [],
    version: a.version, updatedAt: a.updatedAt, owner: a.ownerId ? owners.get(a.ownerId) || null : null, spaceId: a.spaceId,
    hasSpec: !!a.spec, canEdit: canEdit(ctx.user, a),
    myVersion: myVersion ?? null, updateAvailable: myVersion != null && myVersion < a.version
  }
  if (withFiles) {
    const files = await filesOf(a)
    out.spec = a.spec || null
    // sha256：出新版本时「沿用上一版的文件」直接用它，不用重新上传
    out.files = await Promise.all(files.map(async f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, sha256: f.sha256, url: await fileUrl(f.id, ctx.user.id) })))
    const vs = await prisma.assetVersion.findMany({ where: { assetId: a.id }, orderBy: { version: 'desc' }, take: 20 })
    const bm = await briefMap(vs.map(v => v.createdBy))
    out.versions = vs.map(v => ({ version: v.version, changelog: v.changelog, by: bm.get(v.createdBy) || null, at: v.createdAt }))
    const ids = Array.isArray(a.relatedSkillIds) ? a.relatedSkillIds : []
    out.relatedSkills = ids.length ? (await prisma.app.findMany({ where: { id: { in: ids }, kind: 'SKILL', deletedAt: null }, select: { id: true, name: true } })) : []
  }
  return out
}

// ---------- 读 ----------

export async function list(ctx, { category, keyword } = {}) {
  const where = { deletedAt: null, ...(isAdmin(ctx.user) ? {} : { spaceId: ctx.user.spaceId ?? DEFAULT_SPACE_ID }) }
  if (category) {
    if (!CATEGORIES[category]) throw badRequest(`类别只能是 ${Object.keys(CATEGORIES).join(' / ')}`)
    where.category = category
  }
  let rows = await prisma.asset.findMany({ where, orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }] })
  if (keyword) {
    const k = String(keyword).toLowerCase()
    rows = rows.filter(a => [a.name, a.description, ...(a.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(k))
  }
  const [owners, uses, covers] = await Promise.all([
    briefMap(rows.map(a => a.ownerId)),
    prisma.assetUse.findMany({ where: { userId: ctx.user.id, assetId: { in: rows.map(a => a.id) } } }).then(r => new Map(r.map(x => [x.assetId, x.version]))),
    // 列表卡片的封面：当前版本的第一张图
    prisma.assetFile.findMany({ where: { assetId: { in: rows.map(a => a.id) }, mime: { startsWith: 'image/' } }, orderBy: { name: 'asc' } })
  ])
  return Promise.all(rows.map(async a => {
    const d = await dto(ctx, a, { owners, uses })
    const cover = covers.find(f => f.assetId === a.id && f.version === a.version)
    if (cover) d.cover = await fileUrl(cover.id, ctx.user.id)
    return d
  }))
}

export async function detail(ctx, id) {
  return dto(ctx, await load(ctx, id), { withFiles: true })
}

/** 记一次使用（下载、Agent 取用），之后有新版本时提示 */
async function markUsed(userId, a) {
  if (!a.version) return
  await prisma.assetUse.upsert({
    where: { userId_assetId: { userId, assetId: a.id } },
    create: { userId, assetId: a.id, version: a.version },
    update: { version: a.version, usedAt: new Date() }
  })
}

/**
 * 给 Agent：一份资料的规范 + 文件。小的文本文件（SVG、CSS、JSON、Markdown）直接给内容，其他给 15 分钟有效的下载地址
 */
export async function forAgent(ctx, ref) {
  const all = await list(ctx)
  const hit = /^\d+$/.test(String(ref)) ? all.find(a => a.id === Number(ref)) : all.find(a => a.name === String(ref))
  if (!hit) throw notFound(`没有「${ref}」这份资料，或者你没有权限；先用 list_assets 看有哪些`)
  const a = await load(ctx, hit.id)
  const files = await filesOf(a)
  const out = { ...(await dto(ctx, a)), spec: a.spec || null, files: [] }
  for (const f of files) {
    const item = { name: f.name, mime: f.mime, size: f.size, url: await fileUrl(f.id, ctx.user.id) }
    if (f.size <= LIMITS.inlineBytes && TEXT_MIME.test(f.mime)) {
      const blob = await prisma.assetBlob.findUnique({ where: { sha256: f.sha256 } })
      item.content = blob?.content ? Buffer.from(blob.content).toString('utf8') : undefined
    }
    out.files.push(item)
  }
  await markUsed(ctx.user.id, a)
  return out
}

/** 全部品牌规范合在一起：Agent 按公司规范做页面 / PPT 前先调它 */
export async function brandGuidelines(ctx) {
  const consoleTheme = await themeOf(ctx.user)
  const brands = await list(ctx, { category: 'BRAND' })
  if (!brands.length) return { brands: [], consoleTheme, hint: '平台上还没有品牌资料，请管理员在「资料」里上传品牌 VI；consoleTheme 是控制台当前用的配色，可以参考' }
  const out = []
  for (const b of brands) out.push(await forAgent(ctx, b.id))
  const templates = (await list(ctx, { category: 'TEMPLATE' })).map(t => ({ id: t.id, name: t.name, description: t.description, version: t.version }))
  return { brands: out, templates, consoleTheme, hint: '颜色、字体、规则以 spec 为准（consoleTheme 是控制台当前的配色，和 spec 冲突时以 spec 为准）；Logo 等文件用 url 下载（15 分钟内有效）；做 PPT 先用 templates 里的模板（get_asset 取文件）' }
}

/** 这个人看到的控制台 VI：空间自己的，否则平台的 */
async function themeOf(user) {
  const b = await spaceBrand(user?.spaceId)
  const t = b?.theme || await getSetting('appearance').then(a => resolveTheme(a.theme, a.primaryColor))
  return { preset: t.preset, label: t.label, tokens: t.tokens }
}

export async function checkUpdates(ctx, used = []) {
  const all = await list(ctx)
  return (Array.isArray(used) ? used : []).slice(0, 100).map(u => {
    const a = all.find(x => x.id === Number(u?.id))
    if (!a) return { id: u?.id, status: 'not_found' }
    return { id: a.id, name: a.name, status: Number(u.version) >= a.version ? 'up_to_date' : 'update_available', platformVersion: a.version }
  })
}

/** 下载（签名地址，不需要登录头）。dl=1 时算一次使用 */
export async function download(fileId, query) {
  const userId = verifyFile(Number(fileId), query)
  if (!userId) throw forbidden('下载地址无效或已过期，请回到资料页重新打开')
  const f = await prisma.assetFile.findUnique({ where: { id: Number(fileId) } })
  const a = f && await prisma.asset.findFirst({ where: { id: f.assetId, deletedAt: null } })
  if (!f || !a) throw notFound('文件不存在')
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null, active: true } })
  if (!user || !canSee({ ...user, roles: user.roles || [] }, a)) throw forbidden('你没有权限下载这个文件')
  const blob = await prisma.assetBlob.findUnique({ where: { sha256: f.sha256 } })
  if (query.dl === '1') await markUsed(userId, a)
  return { file: f, content: Buffer.from(blob.content) }
}

// ---------- 写：管理员建资料、定责任人；责任人和管理员出新版本 ----------

function fields(b, creating) {
  const d = {}
  if (creating || b.category !== undefined) {
    if (!CATEGORIES[b.category]) throw badRequest(`类别只能是 ${Object.keys(CATEGORIES).join(' / ')}`)
    d.category = b.category
  }
  if (creating || b.name !== undefined) {
    d.name = String(b.name || '').trim().slice(0, 100)
    if (!d.name) throw badRequest('资料名称必填')
  }
  if (b.description !== undefined) d.description = String(b.description || '').trim().slice(0, 1000) || null
  if (b.tags !== undefined) d.tags = (Array.isArray(b.tags) ? b.tags : []).map(t => String(t).trim().slice(0, 20)).filter(Boolean).slice(0, 10)
  if (b.spec !== undefined) d.spec = normalizeSpec(b.spec)
  if (b.relatedSkillIds !== undefined) d.relatedSkillIds = (Array.isArray(b.relatedSkillIds) ? b.relatedSkillIds : []).map(Number).filter(Boolean).slice(0, 10)
  return d
}

export async function create(ctx, b) {
  if (!isAdmin(ctx.user)) throw forbidden('只有管理员能新建资料（建好后可以指定责任人维护）')
  const d = fields(b || {}, true)
  const spaceId = b.spaceId ? (await assertSpace(b.spaceId)).id : (ctx.user.spaceId || DEFAULT_SPACE_ID)
  const a = await prisma.asset.create({ data: { ...d, spaceId, ownerId: b.ownerId ? Number(b.ownerId) : ctx.user.id, createdBy: ctx.user.id } })
  audit(ctx, 'asset.create', { entityType: 'asset', entityId: a.id, detail: { name: a.name, category: a.category } })
  return dto(ctx, a, { withFiles: true })
}

export async function update(ctx, id, b) {
  const a = await load(ctx, id)
  if (!canEdit(ctx.user, a)) throw forbidden('只有责任人和管理员能修改这份资料')
  const d = fields(b || {}, false)
  if (b.ownerId !== undefined) {
    if (!isAdmin(ctx.user)) throw forbidden('只有管理员能换责任人')
    d.ownerId = b.ownerId ? Number(b.ownerId) : null
  }
  if (b.spaceId !== undefined) {
    if (!isAdmin(ctx.user)) throw forbidden('只有管理员能换空间')
    d.spaceId = (await assertSpace(b.spaceId)).id
  }
  const out = await prisma.asset.update({ where: { id: a.id }, data: d })
  audit(ctx, 'asset.update', { entityType: 'asset', entityId: a.id, detail: Object.keys(d) })
  return dto(ctx, out, { withFiles: true })
}

export async function remove(ctx, id) {
  const a = await load(ctx, id)
  if (!isAdmin(ctx.user)) throw forbidden('只有管理员能删除资料')
  await prisma.asset.update({ where: { id: a.id }, data: { deletedAt: new Date() } })
  audit(ctx, 'asset.delete', { entityType: 'asset', entityId: a.id, detail: { name: a.name } })
  return { ok: true }
}

/** 先传文件内容（一次一个），拿到 sha256；再用 publishVersion 组成一个版本 */
export async function uploadBlob(ctx, assetId, content) {
  const a = await load(ctx, assetId)
  if (!canEdit(ctx.user, a)) throw forbidden('只有责任人和管理员能上传')
  if (!Buffer.isBuffer(content) || !content.length) throw badRequest('文件内容为空')
  if (content.length > LIMITS.fileBytes) throw badRequest('单个文件最大 50MB')
  const sha256 = crypto.createHash('sha256').update(content).digest('hex')
  if (!(await prisma.assetBlob.findUnique({ where: { sha256 }, select: { sha256: true } }))) {
    await prisma.assetBlob.create({ data: { sha256, size: content.length, content } })
  }
  return { sha256, size: content.length }
}

/**
 * 出一个新版本：files = [{ name, sha256 }]（新传的用 uploadBlob 返回的 sha256，沿用上一版的文件用它原来的 sha256）
 */
export async function publishVersion(ctx, assetId, { files, changelog }) {
  const a = await load(ctx, assetId)
  if (!canEdit(ctx.user, a)) throw forbidden('只有责任人和管理员能出新版本')
  if (!Array.isArray(files) || !files.length) throw badRequest('新版本至少要有一个文件')
  if (files.length > LIMITS.files) throw badRequest(`一个版本最多 ${LIMITS.files} 个文件`)
  const seen = new Set()
  const rows = []
  for (const f of files) {
    const name = safeName(f?.name)
    if (seen.has(name)) throw badRequest(`文件名重复：${name}`)
    seen.add(name)
    const blob = await prisma.assetBlob.findUnique({ where: { sha256: String(f?.sha256 || '') }, select: { sha256: true, size: true } })
    if (!blob) throw badRequest(`文件「${name}」还没上传`)
    rows.push({ name, sha256: blob.sha256, size: blob.size, mime: mimeOf(name) })
  }
  const version = a.version + 1
  await prisma.$transaction([
    prisma.assetVersion.create({ data: { assetId: a.id, version, changelog: changelog ? String(changelog).slice(0, 1000) : null, createdBy: ctx.user.id } }),
    prisma.assetFile.createMany({ data: rows.map(r => ({ ...r, assetId: a.id, version })) }),
    prisma.asset.update({ where: { id: a.id }, data: { version } })
  ])
  audit(ctx, 'asset.version', { entityType: 'asset', entityId: a.id, detail: { version, files: rows.map(r => r.name) } })
  return detail(ctx, a.id)
}
