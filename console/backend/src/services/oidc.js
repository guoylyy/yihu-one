// 标准 OpenID Connect：让现成的系统（GitLab、Grafana、Jenkins、Metabase……）不改代码，
// 在它们自带的「通用 OIDC / OAuth2 登录」设置里填上平台地址和凭证就能接入统一登录。
//
// 和平台自己的统一认证共用同一套东西：应用登记（client_id = 应用 code）、回调地址校验、可见范围、授权确认、授权码
// 区别只在边界：这里的接口按 OAuth2 / OIDC 规范返回（不套 { code, data }，错误是 { error, error_description }），
// 另外签发 id_token（RS256，公钥在 jwks）
//
//   发现文档  GET  /.well-known/openid-configuration
//   授权      浏览器打开 /sso/authorize（与平台 SDK 同一个页面）
//   换 token  POST /api/oidc/token
//   用户信息  GET  /api/oidc/userinfo
//   公钥      GET  /api/oidc/jwks
//
// 字段按应用能拿的信息范围收敛（apps.scopesOf）：邮箱、手机号属于 contact，部门（groups）属于 org
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { encryptJson, decryptJson } from '../lib/secret.js'
import { signAppToken, verifyToken, loadUser } from '../lib/auth.js'
import { AppError } from '../lib/http.js'
import * as apps from './apps.js'
import * as settings from './settings.js'
import { spaceBrief } from './spaces.js'

export const SCOPES = ['openid', 'profile', 'email', 'phone', 'groups']
const ID_TOKEN_TTL = 7200 // 与 access_token 一致
const KEY_SETTING = 'oidcSigningKey'

/** OAuth2 规范的错误：{ error, error_description } */
export class OAuthError extends Error {
  constructor(error, description, status = 400) {
    super(description)
    this.error = error
    this.status = status
  }
}

/** issuer = 用户浏览器里打开的平台地址（系统设置「访问地址」），客户端会校验它和配置的地址完全一致 */
export async function issuer() {
  const { publicBaseUrl } = await settings.get('general')
  return String(publicBaseUrl || '').replace(/\/+$/, '')
}

export function discovery(iss) {
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/sso/authorize`,
    token_endpoint: `${iss}/api/oidc/token`,
    userinfo_endpoint: `${iss}/api/oidc/userinfo`,
    jwks_uri: `${iss}/api/oidc/jwks`,
    scopes_supported: SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256', 'plain'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'name', 'preferred_username', 'picture', 'roles', 'space', 'space_name',
      'email', 'email_verified', 'phone_number', 'phone_number_verified', 'groups']
  }
}

// ---------- 签名密钥：第一次用到时生成，私钥用 SECRET_KEY 加密后存在 SystemSetting ----------

let cachedKey = null

export function newKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  const kid = crypto.createHash('sha256').update(`${jwk.n}.${jwk.e}`).digest('base64url').slice(0, 16)
  return { kid, privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }), jwk: { kty: 'RSA', n: jwk.n, e: jwk.e } }
}

function readKey(row) {
  try {
    const { privatePem } = decryptJson(row.secretEnc)
    return privatePem ? { kid: row.value.kid, privatePem, jwk: row.value.jwk } : null
  } catch { return null }
}

export async function signingKey() {
  if (cachedKey) return cachedKey
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY_SETTING } })
  let key = row && readKey(row)
  if (!key) {
    // 没有，或 SECRET_KEY 换过且没有重新加密（旧私钥解不开）：生成新的。客户端遇到不认识的 kid 会重新拉 jwks
    if (row) console.warn('[oidc] 签名私钥解不开（SECRET_KEY 变了？），重新生成')
    const k = newKey()
    const data = { value: { kid: k.kid, jwk: k.jwk, createdAt: new Date().toISOString() }, secretEnc: encryptJson({ privatePem: k.privatePem }) }
    if (row) {
      await prisma.systemSetting.update({ where: { key: KEY_SETTING }, data })
      key = k
    } else {
      try {
        await prisma.systemSetting.create({ data: { key: KEY_SETTING, ...data } })
        key = k
      } catch {
        // 并发请求先建好了：用它的
        key = readKey(await prisma.systemSetting.findUnique({ where: { key: KEY_SETTING } }))
        if (!key) throw new Error('OIDC 签名密钥初始化失败')
      }
    }
  }
  cachedKey = key
  return key
}

export async function jwks() {
  const k = await signingKey()
  return { keys: [{ ...k.jwk, kid: k.kid, use: 'sig', alg: 'RS256' }] }
}

// ---------- 用户字段 ----------

export function parseScopes(scope) {
  return new Set(String(scope || '').split(/\s+/).filter(s => SCOPES.includes(s)))
}

/**
 * OIDC 标准字段。requested = 客户端申请的 scope；allowed = 平台给这个应用的信息范围（org / contact）
 * 邮箱、手机号只能由管理员或通讯录同步填写，用户自己改不了，所以标为已验证
 */
export function claimsFor(user, requested, allowed) {
  const c = { sub: String(user.id) }
  if (requested.has('profile')) {
    c.name = user.name
    c.preferred_username = user.username
    if (user.avatar) c.picture = user.avatar
    c.roles = user.roles
    if (user.space) { c.space = user.space.code; c.space_name = user.space.name } // 用户所在空间（公司 / 客户），应用据此分开各空间的数据
  }
  if (requested.has('email') && allowed.has('contact') && user.email) {
    c.email = user.email
    c.email_verified = true
  }
  if (requested.has('phone') && allowed.has('contact') && user.mobile) {
    c.phone_number = user.mobile
    c.phone_number_verified = true
  }
  if (requested.has('groups') && allowed.has('org')) c.groups = (user.depts || []).map(d => d.name)
  return c
}

async function userFor(userId) {
  const u = await loadUser(userId)
  if (!u) return null
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { email: true, mobile: true } })
  return { ...u, email: row?.email || null, mobile: row?.mobile || null, space: await spaceBrief(u.spaceId) }
}

export function signIdToken(key, { iss, aud, nonce, claims, now = Math.floor(Date.now() / 1000) }) {
  const payload = { ...claims, iss, aud, iat: now, exp: now + ID_TOKEN_TTL }
  if (nonce) payload.nonce = nonce
  return jwt.sign(payload, key.privatePem, { algorithm: 'RS256', keyid: key.kid })
}

// ---------- 端点 ----------

/** POST /api/oidc/token：authorization_code 换 access_token + id_token */
export async function token(body) {
  if (body.grant_type !== 'authorization_code') throw new OAuthError('unsupported_grant_type', '只支持 grant_type=authorization_code')
  if (!body.code) throw new OAuthError('invalid_request', '缺少 code')
  let app
  try { app = await apps.authenticateClient(body.client_id, body.client_secret) } catch (e) {
    throw new OAuthError('invalid_client', e.message || 'client 认证失败', 401)
  }
  let row
  try {
    row = await apps.redeemCode(app, { code: body.code, redirect_uri: body.redirect_uri, code_verifier: body.code_verifier, strictRedirect: true })
  } catch (e) {
    if (e instanceof AppError) throw new OAuthError('invalid_grant', e.message)
    throw e
  }
  const requested = parseScopes(row.scope)
  const out = {
    access_token: signAppToken(row.userId, app.code, { scope: [...requested].join(' ') }),
    token_type: 'Bearer',
    expires_in: 7200,
    scope: [...requested].join(' ')
  }
  if (requested.has('openid')) {
    const user = await userFor(row.userId)
    if (!user) throw new OAuthError('invalid_grant', '用户不存在或已停用')
    out.id_token = signIdToken(await signingKey(), {
      iss: await issuer(), aud: app.code, nonce: row.nonce,
      claims: claimsFor(user, requested, new Set(apps.scopesOf(app)))
    })
  }
  return out
}

/** GET /api/oidc/userinfo：Bearer access_token → 标准字段（只给 token 申请过、应用能拿的） */
export async function userinfo(accessToken) {
  let p
  try { p = verifyToken(accessToken) } catch { throw new OAuthError('invalid_token', 'access_token 无效或已过期', 401) }
  if (p.type !== 'app') throw new OAuthError('invalid_token', 'access_token 类型不正确', 401)
  const app = await prisma.app.findFirst({ where: { code: String(p.aud || ''), type: 'SSO', deletedAt: null, status: 'ACTIVE' } })
  if (!app) throw new OAuthError('invalid_token', '应用不存在或已停用', 401)
  const user = await userFor(p.sub)
  if (!user) throw new OAuthError('invalid_token', '用户不存在或已停用', 401)
  return claimsFor(user, parseScopes(p.scope), new Set(apps.scopesOf(app)))
}
