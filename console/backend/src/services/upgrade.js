// 平台自身的版本与升级。控制台不联网、不碰宿主机:
//   宿主机上的 yh 定时上报「当前版本 / 安装方式 / 查到的最新版本」(reportInfo), 概览页据此提示
//   管理员点「升级」→ 排一个 UPGRADE 运维操作(services/platform.js) → yh agent 执行 yh upgrade
//   不能联网的机器: 管理员在这里上传更新包, agent 来取走安装
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/http.js'
import { briefMap } from './users.js'

const INFO_KEY = 'platformInfo'
const SEMVER = /^\d+\.\d+\.\d+$/
/** 更新包大小上限(包里只有源码, 一般不到 1MB) */
export const PACKAGE_MAX = 30 * 1024 * 1024
const KEEP_PACKAGES = 3

/** a 比 b 新 */
export function newer(a, b) {
  if (!SEMVER.test(a || '') || !SEMVER.test(b || '')) return false
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

const text = (v, max) => (v == null ? '' : String(v)).slice(0, max)

// ---------- yh 上报 ----------

export async function reportInfo(b) {
  if (!SEMVER.test(b?.version || '')) throw badRequest('version 须为 x.y.z')
  const l = b.latest && SEMVER.test(b.latest.version || '') ? b.latest : null
  const value = {
    version: b.version,
    mode: b.mode === 'git' ? 'git' : 'package',
    commit: text(b.commit, 40), branch: text(b.branch, 100),
    hasSource: !!b.hasSource, signed: !!b.signed,
    latest: l && { version: l.version, minVersion: text(l.minVersion, 20), date: text(l.date, 20), notes: text(l.notes, 5000), checkedAt: text(l.checkedAt, 40) },
    checkError: text(b.checkError, 500),
    at: new Date().toISOString()
  }
  await prisma.systemSetting.upsert({ where: { key: INFO_KEY }, update: { value }, create: { key: INFO_KEY, value } })
  briefCache = null
  return { ok: true }
}

/** 概览页用: 没上报过(yh 没跑或太旧)返回 null */
export async function getInfo() {
  const row = await prisma.systemSetting.findUnique({ where: { key: INFO_KEY } })
  const v = row?.value
  if (!v?.version) return null
  return { ...v, updateAvailable: v.mode === 'package' && !!v.latest && newer(v.latest.version, v.version) }
}

// 控制台自己的版本(和根目录 VERSION 一起改, scripts/bump-version.sh); yh 还没上报时用它
export const CONSOLE_VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version } catch { return '0.0.0' }
})()
let briefCache = null
let briefAt = 0

/**
 * 给所有登录用户看的平台版本(侧边栏、关于)。版本号 x.y.z 遵循语义化版本, 主版本为 0 时是 Beta(docs/版本管理.md)
 * 以宿主机 yh 上报的为准(平台升级后先变), 没上报过用控制台自己的版本
 */
export async function versionBrief() {
  if (briefCache && Date.now() - briefAt < 60_000) return briefCache
  let info = null
  try { info = await getInfo() } catch { info = null }
  const version = info?.version || CONSOLE_VERSION
  briefCache = { version, channel: version.startsWith('0.') ? 'beta' : 'stable' }
  briefAt = Date.now()
  return briefCache
}

/** 发起升级 / 检查更新前的校验, 返回操作参数 */
export async function checkUpgradeOp(kind, params) {
  const info = await getInfo()
  if (!info) throw badRequest('宿主机上的 yh 还没上报平台版本（yh agent 没在运行？在服务器上执行 yh autostart）')
  if (info.mode !== 'package') throw badRequest(`这台机器是从 Git 安装的，平台跟踪 ${info.branch || 'release'} 分支自动更新，不需要手动升级`)
  if (kind === 'UPGRADE_CHECK') {
    if (!info.hasSource) throw badRequest('没有配置更新地址（服务器 yh.env 里的 UPGRADE_URL）；不能联网的话可以上传更新包')
    return {}
  }
  if (params?.packageId) {
    const pkg = await prisma.platformPackage.findUnique({ where: { id: Number(params.packageId) || 0 }, select: { id: true, version: true, sig: true } })
    if (!pkg) throw notFound('更新包不存在，重新上传')
    if (info.signed && !pkg.sig) throw badRequest('这台机器要求更新包带签名，请连同 .sig 文件一起重新上传')
    return { packageId: pkg.id, version: pkg.version }
  }
  if (!info.updateAvailable) throw badRequest('没有可升级的新版本，先点「检查更新」')
  return { version: info.latest.version }
}

// ---------- 上传的更新包 ----------

/** 从 tar 里按文件名(去掉第一层目录后)取出小文件的内容 */
function tarEntries(tar, wanted) {
  const out = {}
  let off = 0
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512)
    if (h.every(x => x === 0)) break
    const str = (a, b) => { const s = h.subarray(a, b); const z = s.indexOf(0); return s.subarray(0, z < 0 ? s.length : z).toString('utf8') }
    const size = parseInt(str(124, 136).trim() || '0', 8) || 0
    const type = str(156, 157) || '0'
    const prefix = str(257, 263) === 'ustar' ? str(345, 500) : ''
    const name = (prefix ? prefix + '/' : '') + str(0, 100)
    const rel = name.replace(/^\.\//, '').split('/').slice(1).join('/')
    if ((type === '0' || type === '') && wanted.includes(rel) && size < 100_000) out[rel] = tar.subarray(off + 512, off + 512 + size).toString('utf8')
    off += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

/** 读更新包里的版本信息; 不是更新包就报错 */
export function readPackageMeta(buf) {
  let tar
  try { tar = zlib.gunzipSync(buf, { maxOutputLength: 300 * 1024 * 1024 }) } catch { throw badRequest('这不是以虎 One 的更新包（要 scripts/pack.sh 打出来的 yihu-one-<版本>.tar.gz）') }
  const f = tarEntries(tar, ['VERSION', '.yh-release', 'yh'])
  const version = (f.VERSION || '').trim()
  if (!SEMVER.test(version) || !f.yh) throw badRequest('这不是以虎 One 的更新包（包里没有版本号）')
  let rel = {}
  try { rel = JSON.parse(f['.yh-release'] || '{}') } catch { /* 没有发布信息也能装 */ }
  return { version, minVersion: text(rel.minVersion, 20), date: text(rel.date, 20), notes: text(rel.notes, 5000) }
}

const pkgDto = (p, bm = new Map()) => ({
  id: p.id, version: p.version, filename: p.filename, size: p.size, sha256: p.sha256, signed: !!p.sig,
  uploadedBy: p.uploadedBy ? bm.get(p.uploadedBy) || null : null, createdAt: p.createdAt
})
const PKG_FIELDS = { id: true, version: true, filename: true, size: true, sha256: true, sig: true, uploadedBy: true, createdAt: true }

export async function uploadPackage(ctx, buf, { filename, sig } = {}) {
  assertAdmin(ctx)
  if (!Buffer.isBuffer(buf) || !buf.length) throw badRequest('没有收到文件')
  if (buf.length > PACKAGE_MAX) throw badRequest('更新包太大（上限 30MB）')
  const info = await getInfo()
  if (info && info.mode !== 'package') throw badRequest('这台机器是从 Git 安装的，平台跟踪 release 分支自动更新，不用上传更新包')
  const meta = readPackageMeta(buf)
  if (info && !newer(meta.version, info.version)) throw badRequest(`包里的版本 ${meta.version} 不高于当前版本 ${info.version}`)
  if (info && meta.minVersion && newer(meta.minVersion, info.version)) throw badRequest(`这个包要求当前版本不低于 ${meta.minVersion}（现在是 ${info.version}），请先升级到 ${meta.minVersion}`)
  const s = text(sig, 4000).replace(/\s+/g, '')
  if (s && !/^[A-Za-z0-9+/]+=*$/.test(s)) throw badRequest('签名文件内容不对（应该是和更新包一起发布的 .sig 文件）')
  if (info?.signed && !s) throw badRequest('这台机器要求更新包带签名：选文件时把 .tar.gz 和 .sig 一起选上')
  const row = await prisma.platformPackage.create({
    data: {
      version: meta.version, filename: text(filename, 200) || `yihu-one-${meta.version}.tar.gz`, size: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'), sig: s || null, data: buf, uploadedBy: ctx.user.id
    },
    select: PKG_FIELDS
  })
  // 只留最近几个
  const old = await prisma.platformPackage.findMany({ orderBy: { id: 'desc' }, skip: KEEP_PACKAGES, select: { id: true } })
  if (old.length) await prisma.platformPackage.deleteMany({ where: { id: { in: old.map(o => o.id) } } })
  audit(ctx, 'platform.package.upload', { entityType: 'platformPackage', entityId: row.id, detail: { version: row.version, size: row.size, sha256: row.sha256 } })
  return { ...pkgDto(row), ...meta }
}

export async function listPackages(ctx) {
  assertAdmin(ctx)
  const rows = await prisma.platformPackage.findMany({ orderBy: { id: 'desc' }, select: PKG_FIELDS })
  const bm = await briefMap(rows.map(r => r.uploadedBy))
  return rows.map(r => pkgDto(r, bm))
}

export async function removePackage(ctx, id) {
  assertAdmin(ctx)
  const row = await prisma.platformPackage.findUnique({ where: { id: Number(id) || 0 }, select: PKG_FIELDS })
  if (!row) throw notFound('更新包不存在')
  await prisma.platformPackage.delete({ where: { id: row.id } })
  audit(ctx, 'platform.package.remove', { entityType: 'platformPackage', entityId: row.id, detail: { version: row.version } })
  return { ok: true }
}

/** yh agent 取走更新包(PLATFORM_TOKEN) */
export async function packageData(id) {
  const row = await prisma.platformPackage.findUnique({ where: { id: Number(id) || 0 }, select: { data: true } })
  if (!row) throw notFound('更新包不存在')
  return Buffer.from(row.data)
}

export async function packageSig(id) {
  const row = await prisma.platformPackage.findUnique({ where: { id: Number(id) || 0 }, select: { sig: true } })
  if (!row?.sig) throw notFound('这个包没有签名')
  return row.sig
}
