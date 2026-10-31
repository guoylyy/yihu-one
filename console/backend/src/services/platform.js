// 平台运维: 控制台 ↔ 宿主机上的 yh 命令行
// 控制台容器不碰 Docker。插拔应用的动作写成「运维操作」排队, 由宿主机上的 yh agent 领取执行, 再把结果和日志交回来
//   控制台(管理员点「安装 / 发布 / 停用 / 移除 / 日志」) → PlatformOp(PENDING)
//   yh agent 每几秒: POST /api/platform/ops/claim → 执行 yh add / up / update / down → POST /api/platform/ops/:id/finish
// yh 同时用平台接口登记应用(领统一认证凭证)、上报运行状态和发布记录
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin, sha256 } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/http.js'
import { validIcon, validColor } from '../lib/icon.js'
import { forgetAppTools } from '../agent/appTools.js'
import { briefMap } from './users.js'
import { newSecret } from './apps.js'
import { getInfo, checkUpgradeOp } from './upgrade.js'

const SYSTEM = { user: null, via: 'SYSTEM' }
const CODE = /^[a-z][a-z0-9-]{1,30}$/
/** 控制台自己占用的路径, 应用 code 不能用 */
const RESERVED = new Set(['api', 'dev', 'sdk', 'apps', 'login', 'admin', 'me', 'sso', 'assets', 'health', 'console', 'assistant', 'auth', 'platform'])
const KINDS = new Set(['INSTALL', 'DEPLOY', 'START', 'STOP', 'RESTART', 'REMOVE', 'LOGS', 'UPGRADE', 'UPGRADE_CHECK'])
/** 平台自身的操作(升级 / 检查更新)和发布记录记在这个名字下, 不是某个应用 */
const PLATFORM = 'platform'
const LOG_LIMIT = 200_000
/** agent 领了任务却一直没交结果(机器重启等), 超过这个时间算失败, 免得界面一直转圈 */
const STALE_MS = 30 * 60_000

export function checkCode(code) {
  if (!CODE.test(code || '')) throw badRequest('应用 code 须为小写字母开头，只含小写字母、数字、短横线（2~31 位），如 kaoqin、purchase')
  if (RESERVED.has(code)) throw badRequest(`${code} 是控制台保留名称，换一个`)
}

// ---------- yh 调用(PLATFORM_TOKEN) ----------

/**
 * 按应用清单(yh-app.json)登记或更新 SSO 应用。幂等:
 * - 新应用: 创建并返回 clientSecret(只这一次)
 * - 已有应用: 更新名称、地址、MCP 等清单里的信息, 不改密钥; resetSecret=true 时重置并返回新密钥
 * - 可见范围、是否默认、排序: 只在首次登记时取清单里的值, 之后以控制台里的设置为准
 */
export async function registerApp(b) {
  checkCode(b.code)
  const mounts = mountsOf(b.mounts)
  if (!b.name || !b.url) throw badRequest('name、url 必填')
  const manifestIcon = validIcon(b.icon)
  const manifestIconColor = validColor(b.iconColor)
  const data = {
    name: b.name, icon: manifestIcon, iconColor: manifestIconColor, manifestIcon, manifestIconColor, category: b.category || null, description: b.description || null,
    type: 'SSO', url: b.url, redirectUris: b.redirectUris || [], mcpUrl: b.mcpUrl || null,
    managed: true, source: b.source || null, branch: b.branch || null, status: 'ACTIVE', deletedAt: null, mounts
  }
  const existing = await prisma.app.findUnique({ where: { code: b.code } })
  // 应用接入规范 3.1：新接入的应用必须带版本号（缺失不能装）；存量应用不强制，更新时 yh 会提醒补上
  if (!existing && !String(b.version || '').trim()) throw badRequest('yh-app.json 缺少 version 字段（应用接入规范：必须带明确版本号，如 1.0.0）')
  // 管理员 / 创建者在控制台换过图标的，清单里的图标只记下来（「恢复为代码里的图标」用），不覆盖显示的图标
  if (existing?.iconCustom) { delete data.icon; delete data.iconColor }
  let secret = null
  if (!existing || !existing.clientSecretHash || b.resetSecret) secret = newSecret()
  const hash = secret ? { clientSecretHash: sha256(secret) } : {}
  // 已有登记（包括员工在创作中心提交、审核通过后由 agent 安装的代码应用）：只更新清单里的信息，发布范围、可见范围、发布者不动
  // 新登记（管理员在服务器上 yh up）：可信、直接上架
  const app = existing
    ? await prisma.app.update({ where: { id: existing.id }, data: { ...data, ...hash, kind: 'HOSTED' } })
    : await prisma.app.create({
      data: {
        code: b.code, ...data, ...hash, visibility: b.visibility ?? null, isDefault: !!b.isDefault,
        kind: 'HOSTED', scope: 'MARKET', listed: true, trusted: true
      }
    })
  forgetAppTools(app.code)
  audit(SYSTEM, existing ? 'platform.app.update' : 'platform.app.register', { entityType: 'app', entityId: app.id, detail: { code: app.code, url: app.url, secretIssued: !!secret } })
  return { id: app.id, code: app.code, created: !existing, clientId: app.code, clientSecret: secret }
}

/** 下线: 停用(登记、数据保留, 再 up 即恢复) */
export async function disableApp(code) {
  const app = await prisma.app.findUnique({ where: { code } })
  if (!app) return { ok: true }
  await prisma.app.update({ where: { id: app.id }, data: { status: 'DISABLED' } })
  audit(SYSTEM, 'platform.app.disable', { entityType: 'app', entityId: app.id, detail: { code } })
  return { ok: true }
}

/** 移除: 从控制台删掉登记(yh 已把代码和数据挪进备份) */
export async function removeApp(code) {
  const app = await prisma.app.findUnique({ where: { code } })
  if (!app) return { ok: true }
  await prisma.userApp.deleteMany({ where: { appId: app.id } })
  await prisma.app.update({ where: { id: app.id }, data: { deletedAt: new Date(), status: 'DISABLED', code: `${code}~${app.id}` } })
  audit(SYSTEM, 'platform.app.remove', { entityType: 'app', entityId: app.id, detail: { code } })
  return { ok: true }
}

/**
 * yh agent 定时上报各应用运行状态: [{ code, state, health, version, commit, commitAt, deployedAt, memory, mounts }]
 *   version 应用自己的版本号（清单 / package.json），commit 源码提交（Git 接入的才有），deployedAt 最近一次发布 / 重建
 */
export function runtimeOf(r, at) {
  const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null)
  let version = str(r.version, 40)
  let commit = str(r.commit, 40)
  // 老版本 yh 把提交号放在 version 里
  if (version && !commit && /^[0-9a-f]{7,40}$/.test(version)) { commit = version; version = null }
  return { state: str(r.state, 20), health: str(r.health, 40), version, commit, commitAt: str(r.commitAt, 40), deployedAt: str(r.deployedAt, 40), memory: str(r.memory, 40), at }
}

/**
 * yh 上报的宿主目录挂载: 清单 deploy.mounts 的声明 + apps/<code>/.env 里的宿主路径
 * 不是数组时返回 undefined, Prisma 不动这一列(老版本 yh 不报, 清单写错时 yh 报 null: 都保留原来的)
 */
export function mountsOf(list) {
  if (!Array.isArray(list)) return undefined
  const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null)
  return list.slice(0, 32).filter(m => str(m?.name, 32) && str(m?.container, 200)).map(m => ({
    name: str(m.name, 32), container: str(m.container, 200), mode: m.mode === 'rw' ? 'rw' : 'ro', required: m.required === true,
    description: str(m.description, 200), envKey: str(m.envKey, 50), hostPath: str(m.hostPath, 500), configured: m.configured === true, problem: str(m.problem, 300)
  }))
}

export async function reportStatus(list) {
  if (!Array.isArray(list)) throw badRequest('需要数组')
  const at = new Date().toISOString()
  for (const r of list) {
    if (!CODE.test(r?.code || '')) continue
    await prisma.app.updateMany({ where: { code: r.code, deletedAt: null }, data: { runtime: runtimeOf(r, at), mounts: mountsOf(r.mounts) } })
  }
  return { ok: true }
}

export async function addDeployRecord(b) {
  if (!b?.appCode) throw badRequest('appCode 必填')
  await prisma.deployRecord.create({
    data: {
      appCode: String(b.appCode).slice(0, 50), result: String(b.result || '').slice(0, 20), version: b.version?.slice(0, 40) || null,
      author: b.author?.slice(0, 100) || null, subject: b.subject?.slice(0, 500) || null, trigger: b.trigger?.slice(0, 20) || null
    }
  })
  return { ok: true }
}

/** 领一个待执行的操作(同一时间只执行一个), 没有返回 null */
export async function claimOp() {
  await prisma.platformOp.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: 'FAILED', finishedAt: new Date(), log: '执行超时：yh agent 没有交回结果（宿主机重启或 agent 中断？）' }
  })
  if (await prisma.platformOp.count({ where: { status: 'RUNNING' } })) return null
  const op = await prisma.platformOp.findFirst({ where: { status: 'PENDING' }, orderBy: { id: 'asc' } })
  if (!op) return null
  const r = await prisma.platformOp.updateMany({ where: { id: op.id, status: 'PENDING' }, data: { status: 'RUNNING', startedAt: new Date() } })
  if (!r.count) return null
  return { id: op.id, kind: op.kind, appCode: op.appCode, params: op.params || {} }
}

export async function finishOp(id, { ok, log }) {
  const op = await prisma.platformOp.findUnique({ where: { id: Number(id) } })
  if (!op) throw notFound('操作不存在')
  const text = String(log || '')
  await prisma.platformOp.update({
    where: { id: op.id },
    data: { status: ok ? 'SUCCESS' : 'FAILED', finishedAt: new Date(), log: text.length > LOG_LIMIT ? '…(前面省略)\n' + text.slice(-LOG_LIMIT) : text }
  })
  return { ok: true }
}

// ---------- 控制台(管理员) ----------

/** agent 最近在不在: 看最近一次上报(应用状态或平台版本)的时间 */
async function agentSeen(info) {
  const rows = await prisma.app.findMany({ where: { managed: true, deletedAt: null }, select: { runtime: true } })
  const last = [...rows.map(r => r.runtime?.at), info?.at].filter(Boolean).sort().pop() || null
  return { lastSeenAt: last, online: !!last && Date.now() - new Date(last).getTime() < 3 * 60_000 }
}

export async function overview(ctx) {
  assertAdmin(ctx)
  const info = await getInfo()
  const [agent, running, pending] = await Promise.all([
    agentSeen(info),
    prisma.platformOp.findFirst({ where: { status: 'RUNNING' }, orderBy: { id: 'desc' } }),
    prisma.platformOp.count({ where: { status: 'PENDING' } })
  ])
  return { agent, info, running: running ? { id: running.id, kind: running.kind, appCode: running.appCode } : null, pending }
}

/**
 * 发起运维操作
 * INSTALL: params = { git, branch? }; UPGRADE(平台升级): params = { packageId? }; UPGRADE_CHECK(检查更新); 其余: 针对已登记的托管应用
 */
export async function requestOp(ctx, { kind, appCode, params }, { forPublished = false } = {}) {
  assertAdmin(ctx)
  if (!KINDS.has(kind)) throw badRequest(`kind 只能是 ${[...KINDS].join(' / ')}`)
  const forPlatform = kind === 'UPGRADE' || kind === 'UPGRADE_CHECK'
  if (forPlatform) appCode = PLATFORM
  else checkCode(appCode)
  let p = {}
  if (forPlatform) {
    p = await checkUpgradeOp(kind, params)
  } else if (kind === 'INSTALL') {
    const git = String(params?.git || '').trim()
    if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/)\S+$/.test(git)) throw badRequest('请填写 Git 仓库地址（https://、git@ 或 ssh:// 开头）')
    const branch = String(params?.branch || '').trim()
    if (branch && !/^[\w./-]{1,100}$/.test(branch)) throw badRequest('分支名不合法')
    const existing = await prisma.app.findFirst({ where: { code: appCode, deletedAt: null } })
    // 创作中心提交、刚审核通过的代码应用已经有登记（还没装上），允许安装
    if (existing && !(forPublished && existing.kind === 'HOSTED' && !existing.managed)) throw badRequest(`应用 ${appCode} 已存在`)
    p = { git, ...(branch ? { branch } : {}) }
  } else {
    const app = await prisma.app.findFirst({ where: { code: appCode, deletedAt: null } })
    if (!app) throw notFound(`应用 ${appCode} 不存在`)
    if (!app.managed) throw badRequest('只有平台托管的应用能做运维操作')
    if (kind === 'LOGS') p = { lines: Math.min(2000, Math.max(20, Number(params?.lines) || 300)) }
  }
  const busy = await prisma.platformOp.findFirst({ where: { appCode, status: { in: ['PENDING', 'RUNNING'] }, kind: { not: 'LOGS' } } })
  if (busy && kind !== 'LOGS') throw badRequest(`应用 ${appCode} 还有未完成的操作（#${busy.id}），稍等再试`)
  const op = await prisma.platformOp.create({ data: { kind, appCode, params: p, requestedBy: ctx.user.id } })
  if (kind !== 'LOGS' && kind !== 'UPGRADE_CHECK') audit(ctx, `platform.op.${kind.toLowerCase()}`, { entityType: forPlatform ? 'platform' : 'app', entityId: appCode, detail: { opId: op.id, ...p } })
  return opDto(op, new Map())
}

function opDto(o, bm, withLog = false) {
  return {
    id: o.id, kind: o.kind, appCode: o.appCode, params: o.params, status: o.status,
    requestedBy: o.requestedBy ? bm.get(o.requestedBy) || null : null,
    createdAt: o.createdAt, startedAt: o.startedAt, finishedAt: o.finishedAt,
    ...(withLog ? { log: o.log || '' } : {})
  }
}

export async function listOps(ctx, { appCode, limit } = {}) {
  assertAdmin(ctx)
  const rows = await prisma.platformOp.findMany({
    where: { ...(appCode ? { appCode } : {}), kind: { notIn: ['LOGS', 'UPGRADE_CHECK'] } },
    orderBy: { id: 'desc' }, take: Math.min(100, Number(limit) || 30)
  })
  const bm = await briefMap(rows.map(r => r.requestedBy))
  return rows.map(r => opDto(r, bm))
}

export async function getOp(ctx, id) {
  assertAdmin(ctx)
  const o = await prisma.platformOp.findUnique({ where: { id: Number(id) } })
  if (!o) throw notFound('操作不存在')
  return opDto(o, await briefMap([o.requestedBy]), true)
}

export async function listDeploys(ctx, { appCode, limit } = {}) {
  assertAdmin(ctx)
  return prisma.deployRecord.findMany({
    where: appCode ? { appCode } : {}, orderBy: { id: 'desc' }, take: Math.min(100, Number(limit) || 30)
  })
}
