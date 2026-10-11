// 应用市场（所有登录用户）与创作中心（发布者）
import express from 'express'
import { wrap } from '../lib/http.js'
import * as market from '../services/market.js'
import * as studio from '../services/studio.js'
import * as usage from '../services/usage.js'
import * as skills from '../services/skills.js'
import { allToolsFor } from '../agent/agents.js'
import { generate } from '../services/codegen.js'

export const marketRouter = express.Router()
marketRouter.get('/apps', wrap(req => market.list(req.ctx, req.query)))
marketRouter.get('/apps/:id', wrap(req => market.detail(req.ctx, req.params.id)))
marketRouter.post('/apps/:id/rate', wrap(req => market.rate(req.ctx, req.params.id, req.body || {})))
marketRouter.post('/apps/:id/report', wrap(req => market.report(req.ctx, req.params.id, req.body || {})))
// Skill：取生效版本的全部文件（前端打成 ZIP 下载；Agent 走 MCP 的 get_skill）
marketRouter.get('/skills/:id/files', wrap(req => skills.get(req.ctx, req.params.id)))

export const studioRouter = express.Router()
// 做 AI 助手 / 轻应用时可以挑的工具：我自己能用的全部工具（平台通用 + 我能看到的应用的 MCP）
studioRouter.get('/tools', wrap(async (req) => (await allToolsFor(req.ctx.user)).map(t => ({
  name: t.name, label: t.label, description: t.description, write: !!t.write, appCode: t.appCode || null, appName: t.appName || null
}))))
studioRouter.get('/apps', wrap(req => studio.listMine(req.ctx)))
studioRouter.post('/apps', wrap(req => studio.createApp(req.ctx, req.body || {})))
studioRouter.get('/apps/:id', wrap(req => studio.getMine(req.ctx, req.params.id)))
studioRouter.put('/apps/:id', wrap(req => studio.updateListing(req.ctx, req.params.id, req.body || {})))
studioRouter.delete('/apps/:id', wrap(req => studio.removeApp(req.ctx, req.params.id)))
studioRouter.put('/apps/:id/draft', wrap(req => studio.saveDraft(req.ctx, req.params.id, req.body || {})))
studioRouter.post('/apps/:id/submit', wrap(req => studio.submit(req.ctx, req.params.id, req.body || {})))
studioRouter.post('/apps/:id/withdraw', wrap(req => studio.withdraw(req.ctx, req.params.id)))
studioRouter.post('/apps/:id/versions/:vid/restore', wrap(req => studio.restoreVersion(req.ctx, req.params.id, req.params.vid)))
studioRouter.post('/apps/:id/secret', wrap(req => studio.resetSecret(req.ctx, req.params.id)))
studioRouter.get('/apps/:id/usage', wrap(req => usage.stats(req.ctx, req.params.id, req.query)))

// 轻应用：对话生成页面（SSE，协议同 AI 助手：每个事件 data: <json>）
studioRouter.post('/apps/:id/generate', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const emit = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`) }
  const ac = new AbortController()
  res.on('close', () => { if (!res.writableEnded) ac.abort() })
  try {
    await generate(req.ctx, req.params.id, req.body || {}, emit, ac.signal)
  } catch (e) {
    if (!ac.signal.aborted) emit({ type: 'error', message: e.message || '生成失败' })
  } finally {
    emit({ type: 'done' })
    res.end()
  }
})
