// 平台接口: 宿主机上的 yh 命令行用来登记应用、领取运维操作、上报状态
// 鉴权: Authorization: Bearer <PLATFORM_TOKEN>(yh init 生成, 只在服务器上, 不对用户开放)
// 未配置 PLATFORM_TOKEN 时整个接口关闭
import express from 'express'
import crypto from 'node:crypto'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { hashPassword, checkPasswordStrength } from '../lib/auth.js'
import { wrap, AppError, badRequest, notFound } from '../lib/http.js'
import * as svc from '../services/platform.js'
import * as upgrade from '../services/upgrade.js'
import * as notify from '../services/notify.js'

const router = express.Router()

router.use((req, res, next) => {
  const want = process.env.PLATFORM_TOKEN
  const got = (req.headers.authorization || '').replace(/^Bearer /, '')
  if (!want || want.length < 24) return next(new AppError(404, '平台接口未启用', 1004))
  const ok = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))
  if (!ok) return next(new AppError(401, 'PLATFORM_TOKEN 不正确', 1002))
  next()
})

router.get('/ping', (req, res) => res.json({ code: 0, data: { ok: true } }))

router.post('/apps/register', wrap(req => svc.registerApp(req.body || {})))
router.post('/apps/:code/disable', wrap(req => svc.disableApp(req.params.code)))
router.post('/apps/:code/remove', wrap(req => svc.removeApp(req.params.code)))
router.post('/apps/status', wrap(req => svc.reportStatus(req.body?.apps)))
router.post('/deploys', wrap(req => svc.addDeployRecord(req.body || {})))

// 平台自身: 上报版本与最新版本; 取走管理员上传的更新包
router.post('/info', wrap(req => upgrade.reportInfo(req.body || {})))
// yh 的 notify() 取发布通知配置(含机器人 webhook; 控制台连不上时 yh 用本地缓存)
router.get('/notify-config', wrap(() => notify.channels()))
router.get('/packages/:id', wrap(async (req, res) => { res.type('application/gzip').send(await upgrade.packageData(req.params.id)) }))
router.get('/packages/:id/sig', wrap(async (req, res) => { res.type('text/plain').send(await upgrade.packageSig(req.params.id)) }))

router.post('/ops/claim', wrap(async () => (await svc.claimOp()) || { id: null }))
router.post('/ops/:id/finish', express.text({ limit: '5mb', type: 'text/*' }), wrap(req => {
  // 日志可能很长: 结果放查询参数, 日志原文放请求体(text/plain), 省得 yh 里拼 JSON 转义
  const ok = req.query.ok === 'true'
  const log = typeof req.body === 'string' ? req.body : req.body?.log
  return svc.finishOp(req.params.id, { ok, log })
}))

/** 重设某个用户的密码(yh passwd <账号>, 忘记管理员密码时用) */
router.post('/users/password', wrap(async (req) => {
  const { username, password } = req.body || {}
  checkPasswordStrength(password)
  const u = await prisma.user.findFirst({ where: { username: String(username || ''), deletedAt: null } })
  if (!u) throw notFound(`账号 ${username} 不存在`)
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: hashPassword(password), active: true } })
  audit({ user: null, via: 'SYSTEM' }, 'platform.user.password', { entityType: 'user', entityId: u.id, detail: { username } })
  return { ok: true, name: u.name }
}))

router.use((req, res, next) => next(badRequest(`未知的平台接口 ${req.method} ${req.path}`)))

export default router
