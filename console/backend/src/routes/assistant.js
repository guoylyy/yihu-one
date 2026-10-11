// AI 助手: 会话、SSE 对话、确认卡片
import express from 'express'
import { wrap } from '../lib/http.js'
import * as agent from '../agent/runner.js'

const router = express.Router()

router.get('/status', wrap(req => agent.status(req.ctx, { appId: req.query.appId })))
router.get('/conversations', wrap(req => agent.listConversations(req.ctx)))
router.get('/conversations/:id/messages', wrap(req => agent.displayMessages(req.ctx, req.params.id)))
router.delete('/conversations/:id', wrap(req => agent.deleteConversation(req.ctx, req.params.id)))
router.post('/actions/:id/confirm', wrap(req => agent.confirmAction(req.ctx, req.params.id)))
router.post('/actions/:id/cancel', wrap(req => agent.cancelAction(req.ctx, req.params.id)))

router.post('/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // nginx 反代下禁用缓冲
  res.flushHeaders?.()
  const emit = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`) }
  const ac = new AbortController()
  // req 的 close 在请求体读完就会触发, 必须监听 res
  res.on('close', () => { if (!res.writableEnded) ac.abort() })
  try {
    await agent.chat(req.ctx, req.body || {}, emit, ac.signal)
  } catch (e) {
    if (!ac.signal.aborted) {
      console.error('[assistant]', e)
      emit({ type: 'error', message: e.message || '助手出错了' })
    }
  } finally {
    emit({ type: 'done' })
    res.end()
  }
})

export default router
