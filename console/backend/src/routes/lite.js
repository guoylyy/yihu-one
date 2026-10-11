// 轻应用运行时接口（沙箱页面经控制台转发调用）。?version=<id> 表示预览草稿（发布者 / 管理员）
import express from 'express'
import { wrap } from '../lib/http.js'
import * as lite from '../services/lite.js'

const router = express.Router()
const v = (req) => req.query.version || null

router.get('/:id', wrap(req => lite.bootstrap(req.ctx, req.params.id, v(req))))
router.post('/:id/grant', wrap(req => lite.grant(req.ctx, req.params.id)))
router.get('/:id/collections', wrap(req => lite.collections(req.ctx, req.params.id)))
router.get('/:id/export', async (req, res, next) => {
  try {
    const { filename, csv } = await lite.exportCsv(req.ctx, req.params.id, req.query.collection)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.send(csv)
  } catch (e) { next(e) }
})
router.get('/:id/db/:c', wrap(req => lite.list(req.ctx, req.params.id, req.params.c, req.query, v(req))))
router.get('/:id/db/:c/:rid', wrap(req => lite.getOne(req.ctx, req.params.id, req.params.c, req.params.rid, v(req))))
router.post('/:id/db/:c', wrap(req => lite.create(req.ctx, req.params.id, req.params.c, req.body || {}, v(req))))
router.put('/:id/db/:c/:rid', wrap(req => lite.update(req.ctx, req.params.id, req.params.c, req.params.rid, req.body || {}, v(req))))
router.delete('/:id/db/:c/:rid', wrap(req => lite.remove(req.ctx, req.params.id, req.params.c, req.params.rid, v(req))))
router.post('/:id/ai', wrap(req => lite.ask(req.ctx, req.params.id, req.body || {}, v(req))))
router.post('/:id/tools/:name', wrap(req => lite.callTool(req.ctx, req.params.id, req.params.name, req.body?.args || {}, v(req))))

export default router
