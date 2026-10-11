import express from 'express'
import { wrap } from '../lib/http.js'
import * as svc from '../services/apps.js'
import * as usage from '../services/usage.js'

const router = express.Router()
router.get('/', wrap(req => svc.listVisibleApps(req.ctx)))
router.get('/mine', wrap(req => svc.listMyApps(req.ctx)))
router.put('/mine/order', wrap(req => svc.reorder(req.ctx, req.body?.appIds)))
router.post('/:id/install', wrap(req => svc.install(req.ctx, req.params.id)))
router.delete('/:id/install', wrap(req => svc.uninstall(req.ctx, req.params.id)))
// 从工作台打开应用(记一次 launch)
router.post('/:id/launch', wrap(req => usage.launch(req.ctx, req.params.id)))
// 应用使用数据: 管理员或应用负责人
router.get('/:id/usage', wrap(req => usage.stats(req.ctx, req.params.id, req.query)))
export default router
