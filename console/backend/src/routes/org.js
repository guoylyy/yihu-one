// 用户与部门(管理员维护; 查询所有登录用户可用, 选人控件要用)
import express from 'express'
import { wrap } from '../lib/http.js'
import { assertAdmin } from '../lib/auth.js'
import * as svc from '../services/users.js'
import { spaceWhere } from '../services/spaces.js'

const router = express.Router()
const admin = (fn) => wrap(req => { assertAdmin(req.ctx); return fn(req) })

// 同事和部门按空间收敛：普通人只看自己空间；管理员可以 ?spaceId= 看某个空间，不带看全部
router.get('/departments', wrap(req => svc.departmentTree(spaceWhere(req.ctx.user, req.query.spaceId))))
router.post('/departments', wrap(req => svc.createDepartment(req.ctx, req.body || {})))
router.put('/departments/:id', wrap(req => svc.updateDepartment(req.ctx, req.params.id, req.body || {})))
router.delete('/departments/:id', wrap(req => svc.deleteDepartment(req.ctx, req.params.id)))
router.get('/users', wrap(req => svc.listUsers({ ...req.query, space: spaceWhere(req.ctx.user, req.query.spaceId), includeInactive: req.query.includeInactive === 'true' && req.ctx.user.roles.includes('ADMIN') })))
router.post('/users', wrap(req => svc.createUser(req.ctx, req.body || {})))
router.put('/users/:id', wrap(req => svc.updateUser(req.ctx, req.params.id, req.body || {})))
router.put('/users/:id/password', wrap(req => svc.setPassword(req.ctx, req.params.id, req.body?.password || null)))
router.delete('/users/:id', wrap(req => svc.deleteUser(req.ctx, req.params.id)))
// ?dryRun=true 只预览不写库
router.post('/sync', admin(req => svc.syncFromDingtalk(req.ctx, { dryRun: req.query.dryRun === 'true' || req.body?.dryRun === true, spaceId: req.body?.spaceId })))
router.post('/sync/feishu', admin(req => svc.syncFromFeishu(req.ctx, { dryRun: req.query.dryRun === 'true' || req.body?.dryRun === true, spaceId: req.body?.spaceId })))
export default router
