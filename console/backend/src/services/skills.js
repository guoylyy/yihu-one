// Skill 中心：Skill 是和应用并列的一等资产——一个文件夹，入口是 SKILL.md（Agent Skills 标准格式，
// Claude Code、Codex 等 Agent 都认），由用户自己的 Agent 下载到本地使用，平台不执行它。
//
// Skill 就是 App.kind = 'SKILL'：版本、审核、可见范围全部沿用应用那一套（AppVersion / studio.publishVersion / apps.visibleTo），
// 内容放在版本的 payload 里：{ name, description, files: [{ path, data(base64), size }], digest }
//
// 上传的文件按不可信输入处理：路径穿越、绝对路径、隐藏的系统文件、二进制可执行文件、超量都拦
import crypto from 'node:crypto'
import prisma from '../lib/prisma.js'
import { badRequest, notFound } from '../lib/http.js'
import { visibleTo } from './apps.js'
import { briefMap } from './users.js'
import * as studio from './studio.js'

export const LIMITS = { files: 100, totalBytes: 1_000_000, fileBytes: 500_000, pathLength: 200 }
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const BLOCKED_EXT = /\.(exe|dll|so|dylib|bin|com|msi|scr|jar|class|o|a)$/i
const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX(\/.*)?|\.git(\/.*)?)$/

/** 二进制可执行文件的文件头：ELF、Windows PE（MZ）、Mach-O、Java class */
function isExecutable(buf) {
  if (buf.length < 4) return false
  const h = buf.readUInt32BE(0)
  return h === 0x7f454c46 || buf.subarray(0, 2).toString('latin1') === 'MZ' ||
    [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(h)
}

/** 规范化相对路径；不合法返回 null */
export function safePath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!s || s.length > LIMITS.pathLength || s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return null
  const parts = s.split('/')
  if (parts.some(x => !x || x === '.' || x === '..' || /[\u0000-\u001f]/.test(x))) return null
  return parts.join('/')
}

/** 读 SKILL.md 开头的 YAML frontmatter 里的 name / description / version（只认简单的 key: value） */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || '').replace(/^﻿/, ''))
  const out = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

/** 内容指纹：按路径排序后对「路径 + 内容」做 sha256。Agent 拿它判断本地和平台是不是同一份 */
export function digestOf(files) {
  const h = crypto.createHash('sha256')
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    h.update(f.path).update('\0').update(Buffer.from(f.data, 'base64')).update('\0')
  }
  return h.digest('hex').slice(0, 16)
}

/**
 * 规范化 Skill 内容。输入 files: [{ path, data(base64) }] 或 [{ path, content, encoding: 'utf8' | 'base64' }]（MCP 传文本更省事）
 * strict=true 用于提交：必须有 SKILL.md 且写了 name、description
 */
export function normalizeSkillPayload(p = {}, strict = false) {
  const raw = Array.isArray(p.files) ? p.files : []
  const seen = new Map()
  let total = 0
  for (const f of raw) {
    const path = safePath(f?.path)
    if (!path) throw badRequest(`文件路径不合法：${String(f?.path || '').slice(0, 80)}`)
    if (IGNORED.test(path)) continue
    if (BLOCKED_EXT.test(path)) throw badRequest(`不能包含可执行文件：${path}`)
    let buf
    if (typeof f.data === 'string') buf = Buffer.from(f.data, 'base64')
    else if (typeof f.content === 'string') buf = Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8')
    else throw badRequest(`文件没有内容：${path}`)
    if (isExecutable(buf)) throw badRequest(`不能包含可执行文件：${path}`)
    if (buf.length > LIMITS.fileBytes) throw badRequest(`文件太大（超过 ${LIMITS.fileBytes / 1000}KB）：${path}`)
    total += buf.length
    seen.set(path, { path, data: buf.toString('base64'), size: buf.length })
  }
  const files = [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : 1))
  if (files.length > LIMITS.files) throw badRequest(`文件太多（最多 ${LIMITS.files} 个）`)
  if (total > LIMITS.totalBytes) throw badRequest(`Skill 太大（所有文件合计最多 ${LIMITS.totalBytes / 1_000_000}MB）`)
  const entry = files.find(f => f.path === 'SKILL.md')
  const fm = entry ? parseFrontmatter(Buffer.from(entry.data, 'base64').toString('utf8')) : {}
  const name = String(fm.name || '').trim()
  const description = String(fm.description || '').trim()
  if (strict) {
    if (!entry) throw badRequest('缺少 SKILL.md：Skill 文件夹的根目录要有 SKILL.md')
    if (!NAME_RE.test(name)) throw badRequest('SKILL.md 开头要写 name：小写字母、数字、短横线，最多 64 位（如 weekly-report）')
    if (!description) throw badRequest('SKILL.md 开头要写 description：一句话说明这个 Skill 做什么、什么时候用')
    if (description.length > 1024) throw badRequest('description 最多 1024 个字')
  }
  return { name, description: description.slice(0, 1024), version: String(fm.version || '').slice(0, 40), files, digest: files.length ? digestOf(files) : '' }
}

// ---------- 读：给人（市场详情）和 Agent（MCP）用 ----------

async function visibleSkills(ctx) {
  const rows = await prisma.app.findMany({ where: { kind: 'SKILL', deletedAt: null, status: 'ACTIVE', liveVersionId: { not: null } }, orderBy: { updatedAt: 'desc' } })
  return rows.filter(a => visibleTo(a, ctx.user))
}

async function liveVersion(app) {
  return prisma.appVersion.findUnique({ where: { id: app.liveVersionId } })
}

function brief(app, v, publishers) {
  const p = v?.payload || {}
  return {
    id: app.id, name: p.name, title: app.name, description: app.description || p.description,
    version: v?.version, digest: p.digest, fileCount: p.files?.length || 0,
    scope: app.scope, publisher: publishers.get(app.publisherId) || null, updatedAt: v?.reviewedAt || app.updatedAt
  }
}

/** 我能用的 Skill（发布者自己的、分享给我的、上架的），可按关键词筛 */
export async function list(ctx, { keyword } = {}) {
  let apps = await visibleSkills(ctx)
  if (keyword) {
    const k = String(keyword).toLowerCase()
    apps = apps.filter(a => [a.name, a.description, a.category, ...(a.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(k))
  }
  const versions = await prisma.appVersion.findMany({ where: { id: { in: apps.map(a => a.liveVersionId) } } })
  const vm = new Map(versions.map(v => [v.id, v]))
  const publishers = await briefMap(apps.map(a => a.publisherId))
  return apps.map(a => brief(a, vm.get(a.liveVersionId), publishers)).filter(s => s.name)
}

/** 按 id 或 name 找一个我能用的 Skill；同名的有多个时优先我自己发布的，否则报出来让调用方用 id */
async function resolve(ctx, ref) {
  const all = await visibleSkills(ctx)
  if (/^\d+$/.test(String(ref))) {
    const a = all.find(x => x.id === Number(ref))
    if (!a) throw notFound('没有这个 Skill，或者你没有权限')
    return a
  }
  const versions = await prisma.appVersion.findMany({ where: { id: { in: all.map(a => a.liveVersionId) } }, select: { id: true, payload: true } })
  const nameOf = new Map(versions.map(v => [v.id, v.payload?.name]))
  const hits = all.filter(a => nameOf.get(a.liveVersionId) === String(ref))
  if (!hits.length) throw notFound(`没有叫 ${ref} 的 Skill，或者你没有权限`)
  const mine = hits.find(a => a.publisherId === ctx.user.id)
  if (mine) return mine
  if (hits.length > 1) throw badRequest(`有 ${hits.length} 个叫 ${ref} 的 Skill，请用 id：${hits.map(a => a.id).join('、')}`)
  return hits[0]
}

/**
 * 取一个 Skill 的全部文件。textAsUtf8=true（给 Agent）时文本文件直接给原文，省得 Agent 再解码
 */
export async function get(ctx, ref, { textAsUtf8 = false } = {}) {
  const app = await resolve(ctx, ref)
  const v = await liveVersion(app)
  const p = v.payload || {}
  const publishers = await briefMap([app.publisherId])
  prisma.appUsageEvent.create({ data: { appId: app.id, userId: ctx.user.id, action: 'skill.get', source: ctx.via === 'WEB' ? 'WORKBENCH' : 'MCP' } }).catch(() => {})
  const files = (p.files || []).map(f => {
    if (!textAsUtf8) return { path: f.path, size: f.size, data: f.data }
    const buf = Buffer.from(f.data, 'base64')
    const text = buf.toString('utf8')
    const isText = !buf.includes(0) && Buffer.from(text, 'utf8').equals(buf)
    return isText ? { path: f.path, encoding: 'utf8', content: text } : { path: f.path, encoding: 'base64', content: f.data }
  })
  return { ...brief(app, v, publishers), files }
}

/** 本地装着的 Skill 和平台上的比一比：installed = [{ name, version?, digest? }] */
export async function checkUpdates(ctx, installed = []) {
  const mine = await list(ctx)
  return (Array.isArray(installed) ? installed : []).slice(0, 100).map(i => {
    const name = String(i?.name || '')
    const hits = mine.filter(s => s.name === name)
    const s = hits.find(x => x.publisher?.id === ctx.user.id) || hits[0]
    if (!s) return { name, status: 'not_found' }
    const same = i.digest ? i.digest === s.digest : (i.version ? i.version === s.version : false)
    return { name, id: s.id, status: same ? 'up_to_date' : 'update_available', platformVersion: s.version, platformDigest: s.digest, ...(same ? {} : { hint: `平台上是 ${s.version}，用 get_skill 取最新版覆盖本地` }) }
  })
}

// ---------- 写：Agent 一句话上传（网页上传走创作中心，最后都是 studio 的同一套流程） ----------

/**
 * 发布 Skill：没有 skillId 时按 SKILL.md 的 name 找我自己的同名 Skill，找到就出新版本，找不到就新建。
 * 不带 files 只改发布范围。审核策略和网页完全一样（studio.submit）：上架市场要管理员审核，仅自己 / 分享立即生效
 */
export async function publish(ctx, { skillId, files, scope = 'PRIVATE', userIds, deptIds, version, changelog } = {}) {
  let app = null
  let payload = null
  if (files) payload = normalizeSkillPayload({ files }, true)
  if (skillId) {
    app = await prisma.app.findFirst({ where: { id: Number(skillId), kind: 'SKILL', deletedAt: null, publisherId: ctx.user.id } })
    if (!app) throw notFound('没有这个 Skill，或者它不是你发布的')
  } else {
    if (!payload) throw badRequest('新 Skill 要带上文件（至少有 SKILL.md）')
    const mine = await prisma.app.findMany({ where: { kind: 'SKILL', deletedAt: null, publisherId: ctx.user.id } })
    const versions = await prisma.appVersion.findMany({ where: { appId: { in: mine.map(a => a.id) } }, orderBy: { id: 'desc' }, select: { appId: true, payload: true } })
    const hit = versions.find(v => v.payload?.name === payload.name)
    app = hit ? mine.find(a => a.id === hit.appId) : null
    if (!app) {
      const created = await studio.createApp(ctx, { kind: 'SKILL', name: payload.name, description: payload.description.slice(0, 200) })
      app = await prisma.app.findUnique({ where: { id: created.id } })
    }
  }
  if (payload) await studio.saveDraft(ctx, app.id, { payload })
  const visibility = scope === 'PRIVATE' ? undefined : { userIds: userIds || [], deptIds: deptIds || [] }
  const r = await studio.submit(ctx, app.id, { scope, visibility, version: version || payload?.version || undefined, changelog })
  return {
    id: app.id, name: payload?.name, status: r.status, version: r.version.version, scope,
    message: r.status === 'PENDING' ? '已提交，等管理员审核通过后生效' : '已生效',
    url: `/market/${app.id}`
  }
}
