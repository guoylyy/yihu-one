// 身份与权限
// 统一身份上下文 ctx = { user, via, ip }, 路由 / AI 工具 / MCP 都用它调业务层, 权限判断只写一份
// user = { id, name, avatar, roles[], deptIds[], primaryDeptId, depts[], leaderOf[] }
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import prisma from './prisma.js'
import { AppError, forbidden } from './http.js'

export const ROLES = ['ADMIN', 'DEVELOPER', 'MEMBER']
export const API_KEY_PREFIX = 'yh_'

const SECRET = () => {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 16) throw new Error('JWT_SECRET 未配置或过短')
  return s
}

export function signToken(userId, extra = {}, expiresIn = '7d') {
  return jwt.sign({ type: 'internal', sub: userId, ...extra }, SECRET(), { expiresIn })
}

/** 应用 access_token；extra 可带 scope（标准 OIDC 客户端申请的范围，/api/oidc/userinfo 按它给字段） */
export function signAppToken(userId, clientId, extra = {}) {
  return jwt.sign({ type: 'app', sub: userId, aud: clientId, ...extra }, SECRET(), { expiresIn: '2h' })
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET())
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

// ---------- 密码(scrypt, 零依赖) ----------

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(pw), salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(pw, stored) {
  if (!stored?.startsWith('scrypt$')) return false
  const [, salt, hash] = stored.split('$')
  const want = Buffer.from(hash, 'base64')
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length)
  return crypto.timingSafeEqual(want, got)
}

export function checkPasswordStrength(pw) {
  const s = String(pw || '')
  if (s.length < 8) throw new AppError(400, '密码至少 8 位', 1001)
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) throw new AppError(400, '密码需同时包含字母和数字', 1001)
}

// ---------- 用户 ----------

/** 读取用户并组装身份上下文里的 user; 不存在或已停用返回 null */
export async function loadUser(userId) {
  const u = await prisma.user.findFirst({
    where: { id: Number(userId), deletedAt: null, active: true },
    include: { depts: { include: { department: true } } }
  })
  if (!u) return null
  const leaderDepts = await prisma.department.findMany({
    where: { deletedAt: null, leaderIds: { array_contains: [u.id] } },
    select: { id: true }
  })
  const deptIds = u.depts.map(d => d.departmentId)
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    spaceId: u.spaceId ?? 1,
    avatar: u.avatar,
    title: u.title,
    jobNumber: u.jobNumber,
    roles: Array.isArray(u.roles) && u.roles.length ? u.roles : ['MEMBER'],
    deptIds,
    primaryDeptId: u.depts.find(d => d.isPrimary)?.departmentId ?? deptIds[0] ?? null,
    depts: u.depts.map(d => ({ id: d.department.id, name: d.department.name, isPrimary: d.isPrimary })),
    leaderOf: leaderDepts.map(d => d.id),
    hasPassword: !!u.passwordHash,
    dingBound: !!u.dingUserId,
    prefs: u.prefs || {}
  }
}

export const isAdmin = (user) => !!user?.roles?.includes('ADMIN')
/** 能提交代码应用（托管应用）的人：管理员和开发者 */
export const isDeveloper = (user) => isAdmin(user) || !!user?.roles?.includes('DEVELOPER')

export function permissionsOf(user) {
  return { admin: isAdmin(user), developer: isDeveloper(user) }
}

export function assertAdmin(ctx) {
  if (!isAdmin(ctx.user)) throw forbidden('需要管理员权限')
}

function bearer(req) {
  const h = req.headers.authorization || ''
  if (h.startsWith('Bearer ')) return h.slice(7).trim()
  return req.headers['x-api-key'] || null
}

/** 个人 API Key(yh_ 前缀) → { userId, keyId } */
export async function resolveApiKey(key) {
  if (!key?.startsWith(API_KEY_PREFIX)) return null
  const row = await prisma.apiKey.findFirst({ where: { keyHash: sha256(key), revokedAt: null } })
  if (!row) return null
  prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return { userId: row.userId, keyId: row.id }
}

/**
 * 内部接口鉴权: 登录 JWT。挂好 req.ctx
 * allowApiKey=true 时也接受个人 API Key(MCP 用), via 记为 MCP
 */
export function authenticate({ allowApiKey = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = bearer(req)
      if (!token) throw new AppError(401, '未登录', 1002)
      let userId = null
      let via = 'WEB'
      let apiKeyId = null
      if (allowApiKey && token.startsWith(API_KEY_PREFIX)) {
        const k = await resolveApiKey(token)
        userId = k?.userId
        apiKeyId = k?.keyId || null
        via = 'MCP'
      } else {
        let payload
        try { payload = verifyToken(token) } catch { throw new AppError(401, '登录已过期，请重新登录', 1002) }
        if (payload.type !== 'internal') throw new AppError(401, '凭证类型不正确', 1002)
        userId = payload.sub
        // OpenHex 等智能体平台透传用户 JWT 调 MCP 时, 记为 AI 渠道
        if (allowApiKey) via = payload.via || 'AI'
      }
      if (!userId) throw new AppError(401, '凭证无效', 1002)
      const user = await loadUser(userId)
      if (!user) throw new AppError(401, '账号不存在或已停用', 1002)
      req.ctx = { user, via, ip: req.ip }
      if (apiKeyId) req.apiKeyId = apiKeyId
      next()
    } catch (e) {
      next(e)
    }
  }
}
