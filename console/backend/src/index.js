import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import dns from 'node:dns'
import { errorHandler } from './lib/http.js'
import { authenticate } from './lib/auth.js'
import { bootstrap } from './lib/bootstrap.js'
import { mountMcp } from './mcp/index.js'
import authRouter from './routes/auth.js'
import meRouter from './routes/me.js'
import orgRouter from './routes/org.js'
import appsRouter from './routes/apps.js'
import assistantRouter from './routes/assistant.js'
import adminRouter from './routes/admin.js'
import { ssoRouter, openRouter } from './routes/sso.js'
import platformRouter from './routes/platform.js'
import { marketRouter, studioRouter } from './routes/market.js'
import liteRouter from './routes/lite.js'
import setupRouter from './routes/setup.js'
import kbRouter from './routes/kb.js'
import { oidcRouter, discoveryHandler } from './routes/oidc.js'
import assetsRouter, { downloadHandler as assetDownload } from './routes/assets.js'
import { startKbWorker } from './services/kbdoc.js'
import { startScheduler } from './services/schedule.js'
import { ensureBossAssistant } from './services/setup.js'
import * as settings from './services/settings.js'

// 出网（模型、钉钉等）：Node 默认 IPv6/IPv4 竞速、每个地址只等 250ms，容器里 IPv6 不通且对端延迟稍高时会直接 ETIMEDOUT。
// 改为优先 IPv4、按 DNS 顺序直连（纯 IPv6 的地址照样能连）
dns.setDefaultResultOrder('ipv4first')
net.setDefaultAutoSelectFamily(false)

const app = express()
app.set('trust proxy', true)
app.use(cors())

// MCP 自带 body 解析, 必须在全局 express.json 之前
mountMcp(app)
// 应用大模型接口要带图片（base64），单独放宽；其余接口仍是 2mb
app.use('/api/open/llm', express.json({ limit: '20mb' }))
app.use(express.json({ limit: '2mb' }))

app.get('/health', (req, res) => res.json({ ok: true }))
// 企业微信「可信域名」验证文件（「登录方式 → 企业微信应用」里填），要在域名根目录下能访问到
app.get(/^\/(WW_verify_[A-Za-z0-9]{1,64}\.txt)$/, async (req, res, next) => {
  try {
    const content = await settings.domainVerifyFile(req.params[0])
    if (!content) return res.status(404).type('text/plain').send('not found')
    res.type('text/plain').send(content)
  } catch (e) { next(e) }
})

// 浏览器标签页图标：直接按「系统设置 → LOGO」返回，首屏不用等前端配置（否则刷新时会先闪一下默认图标）。
// 没传 LOGO 时 next() 交给 staticDir 里的默认图标；LOGO 存成外链时直接跳过去
app.get('/favicon.svg', async (req, res, next) => {
  try {
    const { logo } = await settings.get('general')
    const data = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(logo || ''))
    if (data) {
      res.type(data[1]).set('Cache-Control', 'public, max-age=60').send(Buffer.from(data[2], 'base64'))
      return
    }
    if (/^https?:\/\//i.test(logo || '')) return res.redirect(302, logo)
    next()
  } catch (e) { next(e) }
})

// 公开 / 应用凭证
app.use('/api/auth', authRouter)
app.use('/api/sso', ssoRouter)
// 标准 OpenID Connect（现成系统用自带的「通用 OIDC 登录」接入）
app.get('/.well-known/openid-configuration', discoveryHandler)
app.use('/api/oidc', oidcRouter)
// 资料下载：签名地址，不需要登录头（Agent 用）
app.get('/api/asset-files/:id', assetDownload)
app.use('/api/open', openRouter)
// 平台接口(宿主机 yh 命令行用, PLATFORM_TOKEN 鉴权)
app.use('/api/platform', platformRouter)
// 首次初始化向导(公开，仅在没有用户时可用)
app.use('/api/setup', setupRouter)

// 以下需要登录
const auth = authenticate()
app.use('/api/org', auth, orgRouter)
app.use('/api/apps', auth, appsRouter)
app.use('/api/assistant', auth, assistantRouter)
app.use('/api/market', auth, marketRouter)
app.use('/api/studio', auth, studioRouter)
app.use('/api/lite', auth, liteRouter)
app.use('/api/admin', auth, adminRouter)
app.use('/api/kb', auth, kbRouter)
app.use('/api/assets', auth, assetsRouter)
// /api/me, /api/workbench, /api/me/api-keys, /api/me/mcp-info —— 放最后, 避免对其他前缀重复鉴权
app.use('/api', auth, meRouter)

// 应用路由由 Caddy 分发; 走到这里说明应用没上线或已停用
app.use('/apps', (req, res) => {
  const code = String(req.path.split('/')[1] || '').replace(/[^a-z0-9-]/g, '')
  res.status(404).type('html').send(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>应用未上线</title>
<div style="font:15px/1.7 system-ui,sans-serif;max-width:480px;margin:18vh auto;padding:0 20px;color:#374151;text-align:center">
<div style="font-size:40px">🧩</div><h2 style="margin:8px 0">应用${code ? `「${code}」` : ''}还没上线，或已停用</h2>
<p style="color:#6b7280">请从工作台进入；如果刚安装或刚发布，稍等一会儿再刷新。</p><p><a href="/" style="color:#2563eb">回到工作台</a></p></div>`)
})
app.use('/api', (req, res) => res.status(404).json({ code: 1004, message: `接口不存在: ${req.method} ${req.originalUrl}` }))
app.use(errorHandler)

// 单容器部署: STATIC_DIR 指向前端构建产物时, 由后端直接托管页面(SPA 回退到 index.html)
const staticDir = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR)
if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
  app.use(express.static(staticDir, { index: false, maxAge: '1h' }))
  app.get(/^\/(?!api\/|health$|apps\/).*/, (req, res) => res.sendFile(path.join(staticDir, 'index.html')))
  console.log(`[yh-console] 托管前端页面: ${staticDir}`)
}

const port = Number(process.env.PORT) || 3105
startKbWorker()
bootstrap()
  // 老平台升级上来补建老板助理；定时任务每分钟检查一次（单元测试不起）
  .then(() => ensureBossAssistant())
  .then(() => (process.env.NODE_ENV === 'test' ? null : startScheduler()))
  .catch(e => console.error('[yh-console] 初始化失败:', e.message))
  .finally(() => app.listen(port, () => console.log(`[yh-console] listening on :${port}`)))
