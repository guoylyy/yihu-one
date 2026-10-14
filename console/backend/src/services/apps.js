// 应用中心与统一认证
// 应用类型: SSO 接入统一认证(OAuth2 授权码模式) / LINK 纯链接
// 插到平台上的应用都按 SSO 接入: 登录走控制台, 工具通过 MCP 并入每个人的 AI 助手
import crypto from 'node:crypto'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin, sha256, signAppToken, verifyToken, loadUser } from '../lib/auth.js'
import { AppError, badRequest, forbidden, notFound } from '../lib/http.js'
import { validIcon, validColor } from '../lib/icon.js'
import { brief, briefMap } from './users.js'
import { appInSpace, assertSpace, spaceBrief } from './spaces.js'

const TYPES = new Set(['LINK', 'SSO'])

const hasRule = (v) => !!v && !!(v.deptIds?.length || v.userIds?.length || v.roles?.length)
const matchRule = (v, user) =>
  !!(v.roles?.some(r => user.roles.includes(r)) ||
    v.deptIds?.some(d => user.deptIds.includes(Number(d))) ||
    v.userIds?.some(id => Number(id) === user.id))

/**
 * 应用对某用户是否可见（能在应用中心看到、能打开、AI 助手能用它的工具）。按「空间 → 组织 → 人」收敛：
 * - 空间：应用不在这个人的空间里（所属空间 + 分享给的空间）就看不到；管理员跨空间
 * - 发布者自己总是可见
 * - PRIVATE 仅自己
 * - SHARED 分享给 visibility 里的人 / 部门 / 角色（满足其一）
 * - MARKET 审核通过上架后：visibility 为空 = 全员，否则按范围；管理员总是可见
 */
export function visibleTo(app, user) {
  if (!appInSpace(app, user)) return false
  if (app.publisherId && app.publisherId === user.id) return true
  if (app.scope === 'PRIVATE') return false
  const v = app.visibility
  if (app.scope === 'SHARED') return hasRule(v) && matchRule(v, user)
  if (!app.listed) return false
  if (!hasRule(v)) return true
  return matchRule(v, user) || user.roles.includes('ADMIN')
}

/** 没有自己首页的应用（AI 助手、轻应用）在控制台里打开 */
export function openUrlOf(app) {
  if (app.kind === 'AGENT') return `/assistant?app=${app.id}`
  if (app.kind === 'LITE') return `/lite/${app.id}`
  if (app.kind === 'SKILL') return `/market/${app.id}` // Skill 不在平台上「打开」，详情页里下载或交给 Agent
  return app.url
}

async function appDtos(apps, installedIds = new Set()) {
  const bm = await briefMap(apps.map(a => a.ownerId))
  return apps.map(a => ({
    id: a.id, code: a.code, name: a.name, icon: a.icon, iconColor: a.iconColor, description: a.description,
    category: a.category, type: a.type, kind: a.kind, scope: a.scope, url: openUrlOf(a),
    installed: installedIds.has(a.id), hasMcp: !!a.mcpUrl, managed: a.managed,
    owner: a.ownerId ? bm.get(a.ownerId) || null : null
  }))
}

/** 能用的应用：托管 / 外部应用要有地址，AI 助手 / 轻应用要有生效的版本（Skill 不是应用，不放工作台，见 MARKET_LISTABLE） */
export const USABLE = { OR: [{ kind: { in: ['EXTERNAL', 'HOSTED'] }, url: { not: null } }, { kind: { in: ['AGENT', 'LITE'] }, liveVersionId: { not: null } }] }
/** 应用市场里能列出的：能用的应用 + 有生效版本的 Skill */
export const MARKET_LISTABLE = { OR: [...USABLE.OR, { kind: 'SKILL', liveVersionId: { not: null } }] }

export async function listVisibleApps(ctx) {
  const apps = await prisma.app.findMany({
    where: { deletedAt: null, status: 'ACTIVE', ...USABLE },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }]
  })
  const mine = await prisma.userApp.findMany({ where: { userId: ctx.user.id } })
  return appDtos(apps.filter(a => visibleTo(a, ctx.user)), new Set(mine.map(m => m.appId)))
}

/** 我的工作台应用; 从没配置过的人自动放上默认应用 */
export async function listMyApps(ctx) {
  let mine = await prisma.userApp.findMany({
    where: { userId: ctx.user.id, app: { deletedAt: null, status: 'ACTIVE' } },
    include: { app: true },
    orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }]
  })
  if (!mine.length) {
    const defaults = (await prisma.app.findMany({
      where: { deletedAt: null, status: 'ACTIVE', isDefault: true, ...USABLE },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }]
    })).filter(a => visibleTo(a, ctx.user))
    if (defaults.length) {
      await prisma.userApp.createMany({
        data: defaults.map((a, i) => ({ userId: ctx.user.id, appId: a.id, sort: i })),
        skipDuplicates: true
      })
      mine = defaults.map(a => ({ app: a }))
    }
  }
  const apps = mine.map(m => m.app).filter(a => visibleTo(a, ctx.user))
  return appDtos(apps, new Set(apps.map(a => a.id)))
}

export async function install(ctx, appId) {
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null, status: 'ACTIVE', ...USABLE } })
  if (!app || !visibleTo(app, ctx.user)) throw notFound('应用不存在')
  // 第一次手动添加前先放上默认应用, 否则「从没配置过」的判断失效, 默认应用就再也不会出现
  if (!(await prisma.userApp.count({ where: { userId: ctx.user.id } }))) await listMyApps(ctx)
  const max = await prisma.userApp.aggregate({ where: { userId: ctx.user.id }, _max: { sort: true } })
  await prisma.userApp.upsert({
    where: { userId_appId: { userId: ctx.user.id, appId: app.id } },
    create: { userId: ctx.user.id, appId: app.id, sort: (max._max.sort ?? -1) + 1 },
    update: {}
  })
  return { ok: true }
}

export async function uninstall(ctx, appId) {
  await prisma.userApp.deleteMany({ where: { userId: ctx.user.id, appId: Number(appId) } })
  return { ok: true }
}

export async function reorder(ctx, appIds) {
  if (!Array.isArray(appIds)) throw badRequest('appIds 必须是数组')
  await prisma.$transaction(appIds.map((id, i) => prisma.userApp.updateMany({
    where: { userId: ctx.user.id, appId: Number(id) }, data: { sort: i }
  })))
  return { ok: true }
}

// ---------- 管理 ----------

function adminDto(a, owners) {
  return {
    id: a.id, code: a.code, name: a.name, icon: a.icon, iconColor: a.iconColor, description: a.description, category: a.category,
    iconCustom: !!a.iconCustom, manifestIcon: a.manifestIcon || null, manifestIconColor: a.manifestIconColor || null,
    type: a.type, url: a.url, redirectUris: a.redirectUris || [], mcpUrl: a.mcpUrl, visibility: a.visibility,
    isDefault: a.isDefault, status: a.status, sort: a.sort,
    spaceId: a.spaceId ?? 1, extraSpaceIds: Array.isArray(a.extraSpaceIds) ? a.extraSpaceIds : [],
    managed: a.managed, source: a.source, branch: a.branch, runtime: a.runtime,
    clientId: a.type === 'SSO' ? a.code : null, hasSecret: !!a.clientSecretHash,
    llmDailyTokenLimit: a.llmDailyTokenLimit ?? null,
    owner: a.ownerId ? owners.get(a.ownerId) || null : null, createdAt: a.createdAt,
    kind: a.kind, scope: a.scope, listed: a.listed, trusted: a.trusted, publisher: a.publisherId ? owners.get(a.publisherId) || null : null
  }
}

export async function adminList(ctx) {
  assertAdmin(ctx)
  // 「管理 → 应用」只管平台级的应用：外部应用和托管应用（员工的 AI 助手、轻应用在「审核与市场」里管）
  const rows = await prisma.app.findMany({ where: { deletedAt: null, kind: { in: ['EXTERNAL', 'HOSTED'] } }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] })
  const bm = await briefMap(rows.flatMap(r => [r.ownerId, r.publisherId]))
  return rows.map(r => adminDto(r, bm))
}

function appData(body, isCreate) {
  const d = {}
  for (const k of ['name', 'description', 'category', 'url', 'mcpUrl']) {
    if (body[k] !== undefined) d[k] = body[k] || null
  }
  if (body.icon !== undefined) d.icon = validIcon(body.icon)
  if (body.iconColor !== undefined) d.iconColor = validColor(body.iconColor)
  if (isCreate || body.type !== undefined) {
    if (!TYPES.has(body.type)) throw badRequest('type 只能是 SSO / LINK')
    d.type = body.type
  }
  if (body.redirectUris !== undefined) {
    if (!Array.isArray(body.redirectUris)) throw badRequest('redirectUris 必须是数组')
    d.redirectUris = body.redirectUris.filter(Boolean)
  }
  if (body.visibility !== undefined) d.visibility = body.visibility || null
  if (body.isDefault !== undefined) d.isDefault = !!body.isDefault
  if (body.status !== undefined) {
    if (!['ACTIVE', 'DISABLED'].includes(body.status)) throw badRequest('status 只能是 ACTIVE / DISABLED')
    d.status = body.status
  }
  if (body.sort !== undefined) d.sort = Number(body.sort) || 0
  if (body.spaceId !== undefined) d.spaceId = Number(body.spaceId) || 1
  if (body.extraSpaceIds !== undefined) d.extraSpaceIds = [...new Set((Array.isArray(body.extraSpaceIds) ? body.extraSpaceIds : []).map(Number).filter(Boolean))]
  if (body.ownerId !== undefined) d.ownerId = body.ownerId ? Number(body.ownerId) : null
  if (body.llmDailyTokenLimit !== undefined) {
    const n = body.llmDailyTokenLimit
    if (n === null || n === '') d.llmDailyTokenLimit = null
    else {
      const v = Number(n)
      if (!Number.isInteger(v) || v < 0) throw badRequest('每日 token 配额须为 ≥0 的整数')
      d.llmDailyTokenLimit = v
    }
  }
  return d
}

export const newSecret = () => 'yhs_' + crypto.randomBytes(24).toString('hex')

/** 应用的所属空间、分享空间都要存在；分享空间里不用再列所属空间 */
async function checkSpaces(d) {
  if (d.spaceId !== undefined) await assertSpace(d.spaceId)
  if (d.extraSpaceIds !== undefined) {
    for (const x of d.extraSpaceIds) await assertSpace(x)
    if (d.spaceId !== undefined) d.extraSpaceIds = d.extraSpaceIds.filter(x => x !== d.spaceId)
  }
}

export async function adminCreate(ctx, body) {
  assertAdmin(ctx)
  if (!body.code || !/^[a-z][a-z0-9-]{1,48}$/.test(body.code)) throw badRequest('code 需为小写字母开头的字母/数字/短横线, 2~49 位')
  if (!body.name) throw badRequest('name 必填')
  const data = appData(body, true)
  if (data.type === 'SSO' && !(data.redirectUris?.length)) throw badRequest('SSO 应用必须填写回调地址 redirectUris')
  data.spaceId = data.spaceId || ctx.user.spaceId || 1 // 没指定就放在登记的管理员自己的空间
  await checkSpaces(data)
  const secret = data.type === 'SSO' ? newSecret() : null
  // 管理员登记的外部应用：可信、直接上架
  const app = await prisma.app.create({
    data: {
      code: body.code, ...data, ownerId: data.ownerId ?? ctx.user.id, clientSecretHash: secret ? sha256(secret) : null,
      kind: 'EXTERNAL', publisherId: ctx.user.id, scope: 'MARKET', listed: true, trusted: true
    }
  })
  audit(ctx, 'app.create', { entityType: 'app', entityId: app.id, detail: { code: app.code, type: app.type } })
  const bm = await briefMap([app.ownerId])
  return { app: adminDto(app, bm), clientId: secret ? app.code : null, clientSecret: secret }
}

export async function adminUpdate(ctx, id, body) {
  assertAdmin(ctx)
  const before = await prisma.app.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!before) throw notFound('应用不存在')
  const data = appData(body, false)
  await checkSpaces(data)
  if (before.managed) {
    // 代码应用：图标可以在这里换（换了以后发布不再覆盖），其他清单里的信息仍以 yh-app.json 为准
    if (body.iconReset) {
      Object.assign(data, { icon: before.manifestIcon, iconColor: before.manifestIconColor, iconCustom: false })
    } else if (data.icon !== undefined || data.iconColor !== undefined) {
      data.iconCustom = true
    }
    for (const k of ['name', 'type', 'url', 'redirectUris', 'mcpUrl', 'category', 'description']) delete data[k]
  }
  const app = await prisma.app.update({ where: { id: before.id }, data })
  // 改成默认应用时, 放到已有用户的工作台上(新用户首次打开时自动获得)
  if (app.isDefault && !before.isDefault && app.status === 'ACTIVE') {
    const users = await prisma.userApp.findMany({ distinct: ['userId'], select: { userId: true } })
    const candidates = await Promise.all(users.map(async u => ({ id: u.userId, user: await loadUser(u.userId) })))
    const data = candidates.filter(c => c.user && visibleTo(app, c.user)).map(c => ({ userId: c.id, appId: app.id, sort: 99 }))
    if (data.length) await prisma.userApp.createMany({ data, skipDuplicates: true })
  }
  audit(ctx, 'app.update', { entityType: 'app', entityId: app.id, detail: body })
  const bm = await briefMap([app.ownerId])
  return adminDto(app, bm)
}

export async function resetSecret(ctx, id) {
  assertAdmin(ctx)
  const app = await prisma.app.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!app) throw notFound('应用不存在')
  if (app.type !== 'SSO') throw badRequest('只有 SSO 应用有密钥')
  const secret = newSecret()
  await prisma.app.update({ where: { id: app.id }, data: { clientSecretHash: sha256(secret) } })
  audit(ctx, 'app.reset-secret', { entityType: 'app', entityId: app.id, detail: { code: app.code } })
  return { clientId: app.code, clientSecret: secret }
}

/** 删除登记(只用于非平台托管的应用; 托管应用走「移除」运维操作) */
export async function adminDelete(ctx, id) {
  assertAdmin(ctx)
  const app = await prisma.app.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!app) throw notFound('应用不存在')
  if (app.managed) throw badRequest('平台托管的应用请用「移除」，会同时停掉容器')
  await prisma.app.update({ where: { id: app.id }, data: { deletedAt: new Date(), status: 'DISABLED', code: `${app.code}~${app.id}` } })
  await prisma.userApp.deleteMany({ where: { appId: app.id } })
  audit(ctx, 'app.delete', { entityType: 'app', entityId: app.id, detail: { code: app.code } })
  return { ok: true }
}

// ---------- 统一认证(OAuth2 授权码) ----------

async function ssoApp(clientId) {
  const app = await prisma.app.findFirst({ where: { code: String(clientId || ''), type: 'SSO', deletedAt: null } })
  if (!app) throw badRequest('client_id 无效')
  if (app.status !== 'ACTIVE') throw badRequest('该应用已停用')
  return app
}

/** 回调地址必须与登记地址同源, 且路径以登记路径开头(防止 http://a.com 前缀匹配到 http://a.com.evil.cn) */
function checkRedirect(app, redirectUri) {
  let target
  try { target = new URL(String(redirectUri)) } catch { throw badRequest('redirect_uri 格式不正确') }
  const ok = (app.redirectUris || []).some(p => {
    try {
      const reg = new URL(p)
      return reg.origin === target.origin && target.pathname.startsWith(reg.pathname)
    } catch { return false }
  })
  if (!ok) throw badRequest('redirect_uri 不在该应用登记的回调地址中')
}

export async function ssoAppInfo(clientId) {
  const app = await ssoApp(clientId)
  return { name: app.name, icon: app.icon, iconColor: app.iconColor, description: app.description }
}

/** 已登录用户为应用签发一次性授权码, 返回应跳转的地址 */
// ---------- 授权确认：员工发布的应用第一次登录时，让用户确认它能拿到哪些信息 ----------
// 管理员安装 / 登记的可信应用（trusted）和发布者自己不用确认；应用申请的信息变多时重新确认

/** 应用能拿到的用户信息范围：trusted = 全部；否则基本信息 + 申请的 org / contact */
export const scopesOf = (app) => (app.trusted ? ['org', 'contact'] : (app.permissions?.scopes || []).filter(s => ['org', 'contact'].includes(s)))
const SCOPE_LABEL = { base: '你的姓名、账号、角色', org: '你的部门、职位、工号', contact: '你的手机号、邮箱' }

async function consentNeeded(ctx, app) {
  if (app.trusted || app.publisherId === ctx.user.id) return null
  const scopes = scopesOf(app)
  const g = await prisma.appGrant.findUnique({ where: { userId_appId: { userId: ctx.user.id, appId: app.id } } })
  const granted = new Set(g?.permissions?.scopes || [])
  if (g && scopes.every(s => granted.has(s))) return null
  const publisher = app.publisherId ? (await briefMap([app.publisherId])).get(app.publisherId) : null
  return {
    items: ['base', ...scopes].map(s => SCOPE_LABEL[s]),
    tools: !!app.mcpUrl, publisher, changed: !!g
  }
}

/** 授权页先问一下：要不要用户确认 */
export async function ssoConsentInfo(ctx, clientId) {
  const app = await ssoApp(clientId)
  if (!visibleTo(app, ctx.user)) throw forbidden(`你没有使用「${app.name}」的权限`)
  return { needConsent: await consentNeeded(ctx, app) }
}

/**
 * 已登录用户为应用签发一次性授权码, 返回应跳转的地址
 * 平台 SDK 只带 client_id / redirect_uri / state；标准 OAuth2 / OIDC 客户端还会带 response_type、scope、nonce、PKCE。
 * 带了 response_type 的按标准处理：用户拒绝、参数不支持时跳回应用并带 error（RFC 6749 4.1.2.1），而不是停在平台页面上
 */
export async function ssoAuthorize(ctx, { client_id, redirect_uri, state, consent, deny, response_type, scope, nonce, code_challenge, code_challenge_method }) {
  const app = await ssoApp(client_id)
  checkRedirect(app, redirect_uri)
  const standard = !!response_type
  const back = (params) => {
    const url = new URL(redirect_uri)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    if (state) url.searchParams.set('state', state)
    return { redirect: url.toString() }
  }
  const fail = (error, desc) => {
    if (!standard) throw badRequest(desc)
    return back({ error, error_description: desc })
  }
  if (standard && response_type !== 'code') return fail('unsupported_response_type', '只支持 response_type=code')
  if (!visibleTo(app, ctx.user)) {
    if (standard) return fail('access_denied', `你没有使用「${app.name}」的权限`)
    throw forbidden(`你没有使用「${app.name}」的权限`)
  }
  if (deny) return fail('access_denied', '用户拒绝了授权')
  const method = code_challenge ? (code_challenge_method || 'plain') : null
  if (code_challenge && !/^[A-Za-z0-9._~-]{43,128}$/.test(code_challenge)) return fail('invalid_request', 'code_challenge 格式不正确')
  if (method && !['S256', 'plain'].includes(method)) return fail('invalid_request', '只支持 code_challenge_method=S256 或 plain')
  if (nonce && String(nonce).length > 255) return fail('invalid_request', 'nonce 过长')
  if (scope && String(scope).length > 500) return fail('invalid_request', 'scope 过长')
  if (await consentNeeded(ctx, app)) {
    if (!consent) throw forbidden('请先确认授权')
    await prisma.appGrant.upsert({
      where: { userId_appId: { userId: ctx.user.id, appId: app.id } },
      create: { userId: ctx.user.id, appId: app.id, permissions: { scopes: scopesOf(app) } },
      update: { permissions: { scopes: scopesOf(app) }, grantedAt: new Date() }
    })
    audit(ctx, 'sso.grant', { entityType: 'app', entityId: app.id, detail: { scopes: scopesOf(app) } })
  }
  const code = crypto.randomBytes(24).toString('hex')
  await prisma.ssoCode.create({
    data: {
      code, appId: app.id, userId: ctx.user.id, redirectUri: redirect_uri, expiresAt: new Date(Date.now() + 5 * 60_000),
      scope: scope ? String(scope) : null, nonce: nonce ? String(nonce) : null,
      codeChallenge: code_challenge || null, codeChallengeMethod: method
    }
  })
  audit(ctx, 'sso.authorize', { entityType: 'app', entityId: app.id, detail: { app: app.code, ...(standard ? { oidc: true } : {}) } })
  return back({ code })
}

/** 应用凭证校验(client_id + client_secret) */
export async function authenticateClient(clientId, clientSecret) {
  const app = await ssoApp(clientId)
  if (!clientSecret || !app.clientSecretHash || sha256(clientSecret) !== app.clientSecretHash) {
    throw new AppError(401, 'client_secret 错误', 1002)
  }
  return app
}

/** 给应用的用户信息：只给它能拿的范围（基本信息总是有；org 部门类、contact 联系方式按授权） */
async function userInfo(userId, app) {
  const u = await loadUser(userId)
  if (!u) throw new AppError(401, '用户不存在或已停用', 1002)
  const row = await prisma.user.findUnique({ where: { id: u.id } })
  const scopes = new Set(app ? scopesOf(app) : ['org', 'contact'])
  return {
    id: u.id, username: u.username, name: u.name, avatar: u.avatar, roles: u.roles, space: await spaceBrief(u.spaceId),
    ...(scopes.has('org') ? { depts: u.depts, leaderOf: u.leaderOf, jobNumber: u.jobNumber, title: u.title, dingUserId: row.dingUserId } : { depts: [], leaderOf: [] }),
    ...(scopes.has('contact') ? { mobile: row.mobile, email: row.email } : {})
  }
}

/** PKCE 校验（RFC 7636）：S256 = base64url(sha256(verifier)) */
export function pkceMatches(challenge, method, verifier) {
  if (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  const want = method === 'S256' ? crypto.createHash('sha256').update(verifier).digest('base64url') : verifier
  return want.length === challenge.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(challenge))
}

/**
 * 核销授权码，返回授权时记下的那一行。平台 SDK 与标准 OIDC 的 token 端点共用
 * strictRedirect: 标准客户端必须带 redirect_uri 且与授权时一致；平台 SDK 可以不带（兼容老应用）
 */
export async function redeemCode(app, { code, redirect_uri, code_verifier, strictRedirect = false }) {
  const row = await prisma.ssoCode.findUnique({ where: { code: String(code || '') } })
  if (!row || row.appId !== app.id) throw badRequest('code 无效')
  if (row.usedAt) throw badRequest('code 已使用')
  if (row.expiresAt < new Date()) throw badRequest('code 已过期')
  if ((redirect_uri || strictRedirect) && redirect_uri !== row.redirectUri) throw badRequest('redirect_uri 与授权时不一致')
  if (row.codeChallenge && !pkceMatches(row.codeChallenge, row.codeChallengeMethod, code_verifier)) throw badRequest('code_verifier 不正确')
  if (!row.codeChallenge && code_verifier) throw badRequest('授权时没有 code_challenge，不能带 code_verifier')
  // 并发换同一个 code 只能成功一次
  const used = await prisma.ssoCode.updateMany({ where: { code: row.code, usedAt: null }, data: { usedAt: new Date() } })
  if (used.count !== 1) throw badRequest('code 已使用')
  // 使用数据: 用户通过统一认证进入了这个应用
  prisma.appUsageEvent.create({ data: { appId: app.id, userId: row.userId, action: 'login', source: 'WORKBENCH' } }).catch(() => {})
  return row
}

/** 授权码换 access_token + 用户信息 */
export async function ssoToken({ client_id, client_secret, code, redirect_uri, code_verifier }) {
  const app = await authenticateClient(client_id, client_secret)
  const row = await redeemCode(app, { code, redirect_uri, code_verifier })
  return {
    access_token: signAppToken(row.userId, app.code),
    token_type: 'Bearer',
    expires_in: 7200,
    user: await userInfo(row.userId, app)
  }
}

/** 应用用 access_token 取当前用户 */
export async function ssoUserInfo(token) {
  let p
  try { p = verifyToken(token) } catch { throw new AppError(401, 'access_token 无效或已过期', 1002) }
  if (p.type !== 'app') throw new AppError(401, 'access_token 类型不正确', 1002)
  const app = await prisma.app.findFirst({ where: { code: String(p.aud || ''), deletedAt: null } })
  return userInfo(p.sub, app)
}

export { brief }
