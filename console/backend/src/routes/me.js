// 当前用户: 身份、工作台、改密码、个人 API Key、MCP 接入信息
import express from 'express'
import crypto from 'node:crypto'
import prisma from '../lib/prisma.js'
import { sha256, verifyPassword, hashPassword, checkPasswordStrength, API_KEY_PREFIX } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { wrap, badRequest, notFound } from '../lib/http.js'
import { meDto } from './auth.js'
import { TOOLS } from '../tools/index.js'
import { loadAppTools } from '../agent/appTools.js'
import * as apps from '../services/apps.js'
import * as home from '../services/home.js'
import { get as getSetting } from '../services/settings.js'

const router = express.Router()

router.get('/me', wrap(async (req) => meDto(req.ctx.user)))

function greeting(name) {
  const h = new Date().getHours()
  const p = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
  return `${p}，${name}`
}

router.get('/workbench', wrap(async (req) => ({ greeting: greeting(req.ctx.user.name), apps: await apps.listMyApps(req.ctx) })))
// 千人千面首页：我的布局（只有自己能看能改）
router.get('/me/home', wrap(req => home.getHome(req.ctx)))
router.put('/me/home', wrap(req => home.saveHome(req.ctx, req.body?.cards)))
router.delete('/me/home', wrap(req => home.resetHome(req.ctx)))
router.get('/me/home/cards/:id/data', wrap(req => home.cardData(req.ctx, req.params.id)))

/** 我的助手：默认助手并入哪些应用的工具（按应用关掉） */
router.get('/me/assistant-apps', wrap(async (req) => {
  const off = new Set(req.ctx.user.prefs?.assistantOffApps || [])
  const list = (await apps.listVisibleApps(req.ctx)).filter(a => a.hasMcp)
  return list.map(a => ({ id: a.id, code: a.code, name: a.name, icon: a.icon, iconColor: a.iconColor, enabled: !off.has(a.code) }))
}))
router.put('/me/assistant-apps', wrap(async (req) => {
  const off = (Array.isArray(req.body?.off) ? req.body.off : []).map(String).filter(c => /^[a-z][a-z0-9-]{1,49}$/.test(c)).slice(0, 200)
  const u = await prisma.user.findUnique({ where: { id: req.ctx.user.id } })
  await prisma.user.update({ where: { id: u.id }, data: { prefs: { ...(u.prefs || {}), assistantOffApps: off } } })
  return { ok: true }
}))

/** 修改自己的资料(目前只有姓名) */
router.put('/me/profile', wrap(async (req) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) throw badRequest('姓名不能为空')
  if (name.length > 50) throw badRequest('姓名最长 50 个字')
  const before = req.ctx.user.name
  await prisma.user.update({ where: { id: req.ctx.user.id }, data: { name } })
  audit(req.ctx, 'user.profile.update', { entityType: 'user', entityId: req.ctx.user.id, detail: { name: { from: before, to: name } } })
  return meDto({ ...req.ctx.user, name })
}))

/** 修改自己的密码: 已有密码要先验证旧密码 */
router.put('/me/password', wrap(async (req) => {
  const { oldPassword, newPassword } = req.body || {}
  const u = await prisma.user.findUnique({ where: { id: req.ctx.user.id } })
  if (!u.username) throw badRequest('你还没有登录账号，请管理员先在「用户」里设置')
  if (u.passwordHash && !verifyPassword(oldPassword || '', u.passwordHash)) throw badRequest('原密码不正确')
  checkPasswordStrength(newPassword)
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: hashPassword(newPassword) } })
  audit(req.ctx, 'user.password.change', { entityType: 'user', entityId: u.id })
  return { ok: true }
}))

router.get('/me/api-keys', wrap(async (req) => {
  return prisma.apiKey.findMany({
    where: { userId: req.ctx.user.id, revokedAt: null },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, agentName: true, createdAt: true },
    orderBy: { id: 'desc' }
  })
}))

router.post('/me/api-keys', wrap(async (req) => {
  const name = String(req.body?.name || '').trim()
  if (!name) throw badRequest('请填写用途名称，如「我的 Claude」')
  const key = API_KEY_PREFIX + crypto.randomBytes(24).toString('hex')
  const row = await prisma.apiKey.create({
    data: { userId: req.ctx.user.id, name, prefix: key.slice(0, 10), keyHash: sha256(key) }
  })
  audit(req.ctx, 'apikey.create', { entityType: 'apiKey', entityId: row.id, detail: { name } })
  return { id: row.id, key }
}))

router.delete('/me/api-keys/:id', wrap(async (req) => {
  const r = await prisma.apiKey.updateMany({
    where: { id: Number(req.params.id), userId: req.ctx.user.id, revokedAt: null },
    data: { revokedAt: new Date() }
  })
  if (!r.count) throw notFound('API Key 不存在')
  audit(req.ctx, 'apikey.revoke', { entityType: 'apiKey', entityId: req.params.id })
  return { ok: true }
}))

router.get('/me/mcp-info', wrap(async (req) => {
  const g = await getSetting('general')
  const base = g.publicBaseUrl || `http://localhost:${process.env.PORT || 3105}`
  const url = `${base.replace(/\/$/, '')}/api/mcp`
  const configExample = JSON.stringify({
    mcpServers: {
      'yihu-one': { type: 'http', url, headers: { Authorization: 'Bearer <你的 API Key>' } }
    }
  }, null, 2)
  return {
    url,
    // 平台通用工具 + 我能看到的应用提供的工具(连不上的应用跳过)
    tools: [...TOOLS, ...(await loadAppTools(req.ctx.user))].map(t => ({ name: t.name, label: t.label, description: t.description, write: !!t.write })),
    configExample,
    // Claude Code 一条命令接入；其他 Agent 按它自己的文档加一个 Streamable HTTP 的 MCP（地址和请求头同上）
    claudeCode: `claude mcp add --transport http yihu-one ${url} --header "Authorization: Bearer <你的 API Key>"`
  }
}))

export default router
