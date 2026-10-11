// 登录: 账号密码 / 钉钉、飞书、企业微信（扫码或网页授权 + 客户端内免登）/ 开发登录(只在测试模式)
// 哪些方式可用由「管理 → 登录方式」决定; 开发登录只能由环境变量 DEV_LOGIN 打开
import express from 'express'
import prisma from '../lib/prisma.js'
import * as ding from '../lib/dingtalk.js'
import * as feishu from '../lib/feishu.js'
import * as wecom from '../lib/wecom.js'
import { signToken, loadUser, permissionsOf, verifyPassword } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { wrap, badRequest, forbidden, AppError } from '../lib/http.js'
import { userFromDingtalk, userFromProvider } from '../services/users.js'
import * as settings from '../services/settings.js'
import { spaceBrief, spaceBrand, allSpaces } from '../services/spaces.js'
import { versionBrief } from '../services/upgrade.js'

const router = express.Router()
export const devLogin = () => process.env.DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production'

/** 当前用户 */
export async function meDto(u) {
  const assistant = await settings.get('assistant')
  return {
    id: u.id, username: u.username, name: u.name, avatar: u.avatar, title: u.title, jobNumber: u.jobNumber,
    depts: u.depts, roles: u.roles, leaderOf: u.leaderOf, hasPassword: u.hasPassword, dingBound: !!u.dingBound,
    permissions: { ...permissionsOf(u), assistant: assistant.enabled },
    space: await spaceBrief(u.spaceId),
    // 只有一个空间时界面上不出现「空间」
    multiSpace: (await allSpaces()).length > 1,
    // 所在空间自己的 VI（null = 跟随平台）
    brand: await spaceBrand(u.spaceId),
    platform: await versionBrief()
  }
}

async function issue(req, userId, method) {
  const user = await loadUser(userId)
  if (!user) throw forbidden('账号不存在或已停用')
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  audit({ user, via: 'WEB', ip: req.ip }, 'auth.login', { detail: { method } })
  const { sessionDays } = await settings.get('login')
  return { token: signToken(user.id, {}, `${sessionDays || 7}d`), user: await meDto(user) }
}

router.get('/config', wrap(async () => ({
  dingtalk: await ding.publicConfig(),
  feishu: await feishu.publicConfig(),
  wecom: await wecom.publicConfig(),
  devLogin: devLogin(),
  ...(await settings.publicConfig())
})))

// ---- 账号密码 ----
// 简单的失败限速: 同一账号 10 分钟内连续失败 5 次, 锁 10 分钟(进程内, 重启清零)
const fails = new Map()
const LOCK_MS = 10 * 60_000

router.post('/password', wrap(async (req) => {
  if (!(await settings.get('login')).password) throw forbidden('账号密码登录已关闭')
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) throw badRequest('请输入账号和密码')
  const f = fails.get(username)
  if (f && f.count >= 5 && Date.now() - f.at < LOCK_MS) throw new AppError(429, '密码错误次数过多，请 10 分钟后再试', 1005)
  const u = await prisma.user.findFirst({ where: { username, deletedAt: null } })
  if (!u || !verifyPassword(password, u.passwordHash)) {
    const cur = f && Date.now() - f.at < LOCK_MS ? f : { count: 0 }
    fails.set(username, { count: cur.count + 1, at: Date.now() })
    audit({ user: null, via: 'WEB', ip: req.ip }, 'auth.login.failed', { detail: { username } })
    throw new AppError(401, '账号或密码不正确', 1002)
  }
  if (!u.active) throw forbidden('账号已停用，请联系管理员')
  fails.delete(username)
  return issue(req, u.id, 'password')
}))

// ---- 钉钉 ----
async function ensureDing() {
  if (!(await ding.enabled())) throw forbidden('钉钉登录未开启')
}

router.post('/dingtalk/scan', wrap(async (req) => {
  await ensureDing()
  if (!req.body?.authCode) throw badRequest('authCode 必填')
  const u = await userFromDingtalk(await ding.userByScanCode(req.body.authCode))
  return issue(req, u.id, 'dingtalk-scan')
}))

router.post('/dingtalk/inapp', wrap(async (req) => {
  await ensureDing()
  if (!req.body?.code) throw badRequest('code 必填')
  const u = await userFromDingtalk(await ding.userByInAppCode(req.body.code))
  return issue(req, u.id, 'dingtalk-inapp')
}))

// ---- 飞书：网页授权码（浏览器里是账号确认页，飞书客户端里静默通过）----
router.post('/feishu', wrap(async (req) => {
  if (!(await feishu.enabled())) throw forbidden('飞书登录未开启')
  const { code, redirectUri } = req.body || {}
  if (!code || !redirectUri) throw badRequest('code、redirectUri 必填')
  const fu = await feishu.loginByCode(String(code), String(redirectUri))
  const u = await userFromProvider('feishu', { id: fu.openId, unionId: fu.unionId, name: fu.name, avatar: fu.avatar, mobile: fu.mobile, email: fu.email })
  return issue(req, u.id, 'feishu')
}))

// ---- 企业微信：扫码登录 / 企业微信客户端内 OAuth 静默授权，都回调带 code ----
router.post('/wecom', wrap(async (req) => {
  if (!(await wecom.enabled())) throw forbidden('企业微信登录未开启')
  if (!req.body?.code) throw badRequest('code 必填')
  const wu = await wecom.loginByCode(String(req.body.code))
  const u = await userFromProvider('wecom', { id: wu.userId, name: wu.name, avatar: wu.avatar, mobile: wu.mobile, email: wu.email })
  return issue(req, u.id, 'wecom')
}))

// ---- 开发登录 ----
router.get('/dev/users', wrap(async () => {
  if (!devLogin()) throw forbidden('开发登录未开启')
  const rows = await prisma.user.findMany({
    where: { active: true, deletedAt: null },
    include: { depts: { include: { department: true } } },
    orderBy: { id: 'asc' }
  })
  return rows.map(u => ({
    id: u.id, name: u.name, username: u.username, title: u.title,
    dept: u.depts.find(d => d.isPrimary)?.department.name || u.depts[0]?.department.name || '',
    roles: u.roles
  }))
}))

router.post('/dev/login', wrap(async (req) => {
  if (!devLogin()) throw forbidden('开发登录未开启')
  if (!req.body?.userId) throw badRequest('userId 必填')
  return issue(req, req.body.userId, 'dev')
}))

export default router
