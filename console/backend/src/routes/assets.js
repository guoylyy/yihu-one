// 资料中心（见 services/assets.js）
import express from 'express'
import { wrap, AppError } from '../lib/http.js'
import * as assets from '../services/assets.js'

const router = express.Router()
router.get('/', wrap(req => assets.list(req.ctx, req.query)))
router.post('/', wrap(req => assets.create(req.ctx, req.body || {})))
router.get('/:id', wrap(req => assets.detail(req.ctx, req.params.id)))
router.put('/:id', wrap(req => assets.update(req.ctx, req.params.id, req.body || {})))
router.delete('/:id', wrap(req => assets.remove(req.ctx, req.params.id)))
// 文件内容以二进制 body 上传，一次一个；返回 sha256，再用 versions 组成新版本
router.post('/:id/blobs', express.raw({ type: () => true, limit: '50mb' }), wrap(req => assets.uploadBlob(req.ctx, req.params.id, req.body)))
router.post('/:id/versions', wrap(req => assets.publishVersion(req.ctx, req.params.id, req.body || {})))
export default router

/**
 * 下载（签名地址，不需要登录头，Agent 拿到就能下）。挂在 /api/asset-files/:id
 * 上传的文件是不可信内容：CSP sandbox + nosniff，图片 inline（页面里 <img> 要用），其他一律 attachment
 */
export async function downloadHandler(req, res) {
  try {
    const { file, content } = await assets.download(req.params.id, req.query || {})
    const inline = file.mime.startsWith('image/') && req.query.dl !== '1'
    res.set({
      'Content-Type': file.mime,
      'Content-Length': String(content.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300'
    })
    res.end(content)
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500
    res.status(status).type('text/plain; charset=utf-8').send(e instanceof AppError ? e.message : '下载失败')
  }
}
