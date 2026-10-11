// 标准 OpenID Connect 端点（见 services/oidc.js）。这里是 OAuth2 边界：不套 { code, data }，错误按规范 { error, error_description }
import express from 'express'
import * as oidc from '../services/oidc.js'

export const oidcRouter = express.Router()

/** 规范要求 token 相关响应不缓存；错误统一转成 OAuth2 形态 */
const handle = fn => async (req, res) => {
  res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache')
  try {
    res.json(await fn(req, res))
  } catch (e) {
    if (!(e instanceof oidc.OAuthError)) {
      console.error('[oidc]', e)
      return res.status(500).json({ error: 'server_error', error_description: '服务器内部错误' })
    }
    if (e.status === 401) {
      res.set('WWW-Authenticate', e.error === 'invalid_client' ? 'Basic realm="oidc"' : `Bearer error="${e.error}"`)
    }
    res.status(e.status).json({ error: e.error, error_description: e.message })
  }
}

/** client_secret_basic：Authorization: Basic base64(urlencode(id):urlencode(secret))（RFC 6749 2.3.1） */
function basicCredentials(req) {
  const h = req.headers.authorization || ''
  if (!h.startsWith('Basic ')) return null
  const raw = Buffer.from(h.slice(6), 'base64').toString()
  const i = raw.indexOf(':')
  if (i < 0) return null
  const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s } }
  return { id: dec(raw.slice(0, i)), secret: dec(raw.slice(i + 1)) }
}

oidcRouter.post('/token', express.urlencoded({ extended: false }), handle(req => {
  const body = { ...(req.body || {}) }
  const basic = basicCredentials(req)
  if (basic) { body.client_id = basic.id; body.client_secret = basic.secret }
  return oidc.token(body)
}))

const userinfo = handle(req => {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : (req.body?.access_token || '')
  if (!token) throw new oidc.OAuthError('invalid_token', '缺少 access_token', 401)
  return oidc.userinfo(token)
})
oidcRouter.get('/userinfo', userinfo)
oidcRouter.post('/userinfo', express.urlencoded({ extended: false }), userinfo)

oidcRouter.get('/jwks', async (req, res, next) => {
  try { res.set('Cache-Control', 'public, max-age=3600').json(await oidc.jwks()) } catch (e) { next(e) }
})

/** 挂在站点根上（/.well-known 不在 /api 下） */
export async function discoveryHandler(req, res, next) {
  try { res.set('Cache-Control', 'public, max-age=3600').json(oidc.discovery(await oidc.issuer())) } catch (e) { next(e) }
}
