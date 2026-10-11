// 平台知识库(管理员维护): 知识库 CRUD、文档上传(二进制)、重处理 / 删除
import express from 'express'
import { wrap } from '../lib/http.js'
import { assertAdmin } from '../lib/auth.js'
import * as kb from '../services/kb.js'
import * as kbdoc from '../services/kbdoc.js'

const router = express.Router()
// 整个知识库管理接口只给管理员（普通人检索知识走 search_knowledge，那里按可见范围和空间收敛）
router.use((req, res, next) => { try { assertAdmin(req.ctx); next() } catch (e) { next(e) } })

router.get('/', wrap(() => kb.listForAdmin()))
router.post('/', wrap(req => kb.createKb(req.ctx, req.body || {})))
router.put('/:id', wrap(req => kb.updateKb(req.ctx, req.params.id, req.body || {})))
router.delete('/:id', wrap(req => kb.deleteKb(req.ctx, req.params.id)))

router.get('/:id/documents', wrap(req => kbdoc.listDocuments(req.params.id)))
// 文件以二进制 body 上传; 文件名/类型放 query
router.post('/:id/documents', express.raw({ type: ['application/octet-stream', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'], limit: '50mb' }),
  wrap(req => kbdoc.uploadDocument(req.ctx, req.params.id, { name: req.query.name, content: req.body })))
router.post('/documents/:docId/reprocess', wrap(req => kbdoc.reprocess(req.ctx, req.params.docId)))
router.delete('/documents/:docId', wrap(req => kbdoc.deleteDocument(req.ctx, req.params.docId)))

export default router
