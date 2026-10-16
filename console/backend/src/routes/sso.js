// 统一认证(OAuth2 授权码)与开放接口, 给其他应用接入
//   浏览器: 应用把用户带到工作台前端 /sso/authorize?client_id&redirect_uri&state
//          → 前端(已登录)调 POST /api/sso/authorize 拿到带 code 的回调地址并跳转
//   应用服务端: POST /api/sso/token 用 code 换 access_token + 用户信息; GET /api/sso/userinfo
//   开放接口(应用凭证 Basic client_id:client_secret): 应用信息、用户主数据、给个人发消息、使用数据上报
import express from 'express'
import { wrap, AppError } from '../lib/http.js'
import { authenticate } from '../lib/auth.js'
import * as apps from '../services/apps.js'
import * as llm from '../services/llm.js'
import { masterUsers } from '../services/users.js'
import { spacesOfApp } from '../services/spaces.js'
import * as usage from '../services/usage.js'
import * as openApp from '../services/openApp.js'
import * as storage from '../services/objectStorage.js'

export const ssoRouter = express.Router()

ssoRouter.get('/app-info', wrap(req => apps.ssoAppInfo(req.query.client_id)))
ssoRouter.get('/consent', authenticate(), wrap(req => apps.ssoConsentInfo(req.ctx, req.query.client_id)))
ssoRouter.post('/authorize', authenticate(), wrap(req => apps.ssoAuthorize(req.ctx, req.body || {})))

// token 端点兼容 JSON 与表单两种提交, 以及 Basic 认证传 client 凭证
ssoRouter.post('/token', express.urlencoded({ extended: false }), wrap(req => {
  const body = { ...(req.body || {}) }
  const basic = parseBasic(req)
  if (basic) { body.client_id ||= basic.id; body.client_secret ||= basic.secret }
  return apps.ssoToken(body)
}))

ssoRouter.get('/userinfo', wrap(req => {
  const h = req.headers.authorization || ''
  if (!h.startsWith('Bearer ')) throw new AppError(401, '缺少 access_token', 1002)
  return apps.ssoUserInfo(h.slice(7))
}))

function parseBasic(req) {
  const h = req.headers.authorization || ''
  if (!h.startsWith('Basic ')) return null
  const [id, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':')
  return { id, secret: rest.join(':') }
}

/**
 * 应用凭证: Basic(client_id:client_secret),
 * 或 OpenAI SDK 风格 Bearer(apiKey 填 client_id:client_secret)
 */
function parseAppCredentials(req) {
  const b = parseBasic(req)
  if (b) return b
  const h = req.headers.authorization || ''
  if (h.startsWith('Bearer ')) {
    const v = h.slice(7).trim()
    const i = v.indexOf(':')
    if (i > 0) return { id: v.slice(0, i), secret: v.slice(i + 1) }
  }
  return null
}

// OpenAI 边界错误类型(/llm 路径): 错误体用 { error: { message, type, code } }
const OPENAI_ERROR_TYPE = {
  400: 'invalid_request_error', 401: 'authentication_error', 403: 'invalid_request_error',
  404: 'not_found_error', 429: 'rate_limit_error'
}
function sendOpenAiError(res, e) {
  const status = e instanceof AppError ? e.status : 500
  res.status(status).json({ error: { message: e.message, type: OPENAI_ERROR_TYPE[status] || 'api_error', code: String(e.code || status) } })
}

/** 开放接口鉴权: 应用凭证。/llm 路径是 OpenAI 边界, 鉴权失败也返回 OpenAI error 形态 */
async function appAuth(req, res, next) {
  const openAiPath = req.path.startsWith('/llm')
  try {
    const b = parseAppCredentials(req)
    if (!b) throw new AppError(401, '需要应用凭证（Basic client_id:client_secret）', 1002)
    req.app_ = await apps.authenticateClient(b.id, b.secret)
    next()
  } catch (e) {
    if (openAiPath) return sendOpenAiError(res, e)
    next(e)
  }
}

export const openRouter = express.Router()
openRouter.use(appAuth)
// 用户主数据: 各应用按控制台的账号/工号/部门对人
// 只给应用能用的空间里的人（应用只属于一个空间时，就是那个空间）
openRouter.get('/users', wrap(req => masterUsers({ ...req.query, spaceIds: spacesOfApp(req.app_) })))
// 应用自身信息: 所属空间、平台(或空间)的名称 / LOGO / 主题
openRouter.get('/app', wrap(req => openApp.appInfo(req.app_)))
// 给个人发消息: 经平台配置的钉钉 / 飞书 / 企业微信(只有可信应用)
openRouter.post('/notify', wrap(req => openApp.notifyUsers(req.app_, req.body || {})))
// 文件存储（七牛云）: 平台发上传凭证 / 下载地址, 文件不经过平台; 应用只能动自己的目录 apps/<code>/
openRouter.get('/storage', wrap(req => storage.info(req.app_)))
openRouter.post('/storage/upload-token', wrap(req => storage.uploadToken(req.app_, req.body || {})))
openRouter.get('/storage/url', wrap(req => storage.downloadUrl(req.app_, req.query)))
openRouter.get('/storage/stat', wrap(req => storage.stat(req.app_, req.query.key)))
openRouter.get('/storage/list', wrap(req => storage.list(req.app_, req.query)))
openRouter.delete('/storage/object', wrap(req => storage.remove(req.app_, req.query.key)))
// 使用数据上报: 用户在应用里做了什么
openRouter.post('/events', wrap(req => usage.ingest(req.app_, req.body || {})))
// 应用大模型: OpenAI 兼容, 平台托管模型与密钥; 可选 X-User-Token 按人记用量
// 注意: 此端点是 OpenAI 边界, 不套平台统一的 { code, data } 包装
openRouter.get('/llm/models', async (req, res) => {
  try {
    res.json(await llm.modelList(req.app_, { ip: req.ip, userToken: req.headers['x-user-token'] || '' }))
  } catch (e) {
    sendOpenAiError(res, e)
  }
})
openRouter.post('/llm/embeddings', async (req, res) => {
  try {
    res.json(await llm.embeddings(req.app_, req.body || {}, { ip: req.ip, userToken: req.headers['x-user-token'] || '' }))
  } catch (e) {
    sendOpenAiError(res, e)
  }
})
openRouter.post('/llm/chat/completions', async (req, res) => {
  const opts = { ip: req.ip, userToken: req.headers['x-user-token'] || '' }
  try {
    if ((req.body || {}).stream) {
      await llm.streamCompletion(req.app_, req.body || {}, opts, res)
      return
    }
    res.json(await llm.chatCompletion(req.app_, req.body || {}, opts))
  } catch (e) {
    if (res.headersSent) return // 流式已在服务内部处理
    sendOpenAiError(res, e)
  }
})
