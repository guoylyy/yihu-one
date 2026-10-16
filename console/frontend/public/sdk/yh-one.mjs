// 以虎 One 应用接入 SDK（Node 18+，零依赖，ESM）
// 一个文件解决四件事，直接拷进项目使用：
//   1. 统一认证：没登录就跳平台授权页，回调时用 code 换用户身份
//   2. 使用数据：把「谁在应用里做了什么」上报给平台（批量、后台发送，失败不影响业务）
//   3. 身份校验：平台 AI 助手调本应用 MCP 时带的 access_token，换成用户身份
//   4. 大模型：应用直接用平台配置好的模型（OpenAI 兼容），不用自己配密钥
//   5. 文件存储：大文件（课件、视频、图片）放平台配置的对象存储（七牛云），不用自己配密钥，也不用进代码仓库
//
// 配置（环境变量或构造参数）：
//   YH_CLIENT_ID / YH_CLIENT_SECRET   平台托管的应用由 yh 自动注入；外部应用在「管理 → 应用 → 登记外部应用」获得
//   YH_WEB_URL                        平台访问地址（浏览器跳转授权页用）
//   YH_API_URL                        平台接口地址（服务端换 token、上报数据用；平台内是 http://yh-console:3105）
//   YH_APP_URL                        本应用对外地址，回调地址 = YH_APP_URL + /sso/callback
//   YH_BASE_PATH                      平台挂载的路径前缀（如 /apps/kaoqin，平台自动注入；本地开发不用配）
//
// 挂在平台域名的 /apps/<code> 下时，平台剥掉前缀再转发，前缀放在 X-Forwarded-Prefix 请求头里：
// 页面里的接口地址写相对路径（fetch('api/x')，不要写 '/api/x'），服务端跳转和 cookie 路径用 basePathOf(req) 拼。
//
// 文档：平台开发中心 /dev/sdk-node    下载：/sdk/yh-one.mjs
import crypto from 'node:crypto'

const SESSION_COOKIE = 'yh_sid'
const SESSION_TTL = 8 * 3600_000
const STATE_TTL = 600_000
const TOKEN_CACHE_TTL = 300_000

export class WorkspaceError extends Error {}

const PREFIX_RE = /^\/apps\/[a-z0-9-]+$/
/** 平台转发时带的路径前缀（X-Forwarded-Prefix），如 /apps/kaoqin；直连（本地开发）时为空串 */
export function basePathOf(req) {
  const p = String(req.headers['x-forwarded-prefix'] || '').trim().replace(/\/$/, '')
  return PREFIX_RE.test(p) ? p : ''
}

export class Workspace {
  constructor(opts = {}) {
    const env = process.env
    this.clientId = opts.clientId || env.YH_CLIENT_ID || ''
    this.clientSecret = opts.clientSecret || env.YH_CLIENT_SECRET || ''
    this.webUrl = (opts.webUrl || env.YH_WEB_URL || 'http://localhost:5185').replace(/\/$/, '')
    this.apiUrl = (opts.apiUrl || env.YH_API_URL || 'http://localhost:3105').replace(/\/$/, '')
    this.appUrl = (opts.appUrl || env.YH_APP_URL || '').replace(/\/$/, '')
    const bp = (opts.basePath ?? env.YH_BASE_PATH ?? '').replace(/\/$/, '')
    this.basePath = PREFIX_RE.test(bp) ? bp : ''
    this.sessions = new Map()
    this.tokenCache = new Map()
    this.queue = []
    if (this.enabled) setInterval(() => this.flush(), 3000).unref()
  }

  /** 没配凭证时不启用：应用保持原来的匿名模式，方便本地开发 */
  get enabled() { return !!(this.clientId && this.clientSecret && this.appUrl) }
  get redirectUri() { return `${this.appUrl}/sso/callback` }
  basic() { return 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64') }

  async call(method, path, { body, headers } = {}) {
    let r
    try {
      r = await fetch(this.apiUrl + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000)
      })
    } catch (e) {
      throw new WorkspaceError(`连不上平台 ${this.apiUrl}：${e.message}`)
    }
    const j = await r.json().catch(() => ({}))
    if (j.code !== 0) throw new WorkspaceError(j.message || `平台返回 HTTP ${r.status}`)
    return j.data
  }

  // ---------- 会话 ----------
  sid(req) { return /(?:^|;\s*)yh_sid=([^;]+)/.exec(req.headers.cookie || '')?.[1] }

  session(req) {
    const s = this.sessions.get(this.sid(req))
    if (s && s.expiresAt < Date.now()) { this.sessions.delete(this.sid(req)); return null }
    return s || null
  }

  /** 当前登录的用户；未登录返回 null */
  currentUser(req) { return this.session(req)?.user || null }

  /** 跳转统一认证。res 为 Node/Express 的响应对象 */
  beginLogin(req, res, nextPath = '/') {
    const base = basePathOf(req)
    let sid = this.sid(req)
    let s = this.session(req)
    if (!s) {
      sid = crypto.randomBytes(24).toString('base64url')
      s = { user: null, expiresAt: Date.now() + SESSION_TTL }
      this.sessions.set(sid, s)
      // 同一域名下挂着多个应用，cookie 限定在本应用的路径下，互不覆盖
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; Path=${base || '/'}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`)
    }
    s.state = crypto.randomBytes(16).toString('base64url')
    s.stateAt = Date.now()
    s.next = base + (nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/')
    const u = new URL('/sso/authorize', this.webUrl)
    u.searchParams.set('client_id', this.clientId)
    u.searchParams.set('redirect_uri', this.redirectUri)
    u.searchParams.set('state', s.state)
    res.statusCode = 302
    res.setHeader('Location', u.toString())
    res.end()
  }

  /** 回调：校验 state → code 换用户身份。返回登录后要去的路径 */
  async finishLogin(req, { code, state }) {
    const s = this.session(req)
    const ok = s?.state && state && s.state.length === state.length &&
      crypto.timingSafeEqual(Buffer.from(s.state), Buffer.from(state))
    if (!ok) throw new WorkspaceError('登录校验失败（state 不匹配），请从平台重新打开应用')
    if (Date.now() - s.stateAt > STATE_TTL) throw new WorkspaceError('登录超时，请从平台重新打开应用')
    const data = await this.call('POST', '/api/sso/token', {
      body: { code, redirect_uri: this.redirectUri },
      headers: { Authorization: this.basic() }
    })
    s.user = data.user
    s.state = null
    s.expiresAt = Date.now() + SESSION_TTL
    return s.next
  }

  logout(req) { this.sessions.delete(this.sid(req)) }

  /**
   * Express 中间件：挂上 /sso/callback，其余请求要求登录（未启用时直接放行）
   *   app.use(ws.middleware())
   *   app.get('/', (req, res) => res.send(`你好 ${req.yhUser?.name}`))
   */
  middleware({ publicPaths = ['/mcp'] } = {}) {
    return async (req, res, next) => {
      if (!this.enabled) return next()
      const path = (req.originalUrl || req.url).split('?')[0]
      if (path === '/sso/callback') {
        try {
          const q = new URL(req.url, 'http://x').searchParams
          const to = await this.finishLogin(req, { code: q.get('code'), state: q.get('state') })
          res.statusCode = 302
          res.setHeader('Location', to)
          return res.end()
        } catch (e) {
          res.statusCode = 401
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          return res.end(`登录失败：${e.message}`)
        }
      }
      if (publicPaths.some(p => path.startsWith(p))) return next()
      const user = this.currentUser(req)
      if (user) { req.yhUser = user; return next() }
      if (path.startsWith('/api/')) {
        res.statusCode = 401
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        return res.end(JSON.stringify({ error: '未登录或登录已过期，请从平台重新打开' }))
      }
      return this.beginLogin(req, res, req.originalUrl || req.url)
    }
  }

  // ---------- MCP 身份 ----------
  /** 平台 AI 助手调 MCP 时带 Bearer access_token（代表当前用户），换成用户信息；无效返回 null */
  async userFromToken(authorization) {
    if (!authorization?.startsWith('Bearer ')) return null
    const token = authorization.slice(7).trim()
    const hit = this.tokenCache.get(token)
    if (hit && hit.until > Date.now()) return hit.user
    try {
      const user = await this.call('GET', '/api/sso/userinfo', { headers: { Authorization: `Bearer ${token}` } })
      this.tokenCache.set(token, { until: Date.now() + TOKEN_CACHE_TTL, user })
      return user
    } catch {
      return null
    }
  }

  // ---------- 使用数据 ----------
  /** 记录一次使用。只报动作和业务摘要，不要报敏感原文（聊天内容、手机号等） */
  track(user, action, detail) {
    if (!this.enabled || !user) return
    if (this.queue.length >= 10000) return // 宁可丢统计，也不能拖慢业务
    this.queue.push({ userId: user.id, action, detail, at: new Date().toISOString() })
    if (this.queue.length >= 100) this.flush()
  }

  async flush() {
    if (!this.queue.length || this.flushing) return
    this.flushing = true
    const batch = this.queue.splice(0, 100)
    try {
      const r = await this.call('POST', '/api/open/events', { body: { events: batch }, headers: { Authorization: this.basic() } })
      if (r.rejected?.length) console.warn('[yh-one] 上报被拒', r.rejected.slice(0, 3))
    } catch (e) {
      console.warn(`[yh-one] 使用数据上报失败，丢弃 ${batch.length} 条：${e.message}`)
    } finally {
      this.flushing = false
    }
  }

  // ---------- 大模型 ----------
  /**
   * 调用平台托管的大模型（OpenAI 兼容）。opts 同 OpenAI chat.completions：
   *   messages（必填）、model、temperature、tools、stream 等；默认用平台默认模型
   * 另可传 opts.userToken（统一认证的 access_token）→ 按人记用量、按角色过滤模型
   * 非流式返回 OpenAI chat.completion；stream=true 返回可异步迭代的 SSE 对象流
   */
  async llm(opts = {}) {
    if (!this.clientId || !this.clientSecret) throw new WorkspaceError('缺少应用凭证（YH_CLIENT_ID / YH_CLIENT_SECRET）')
    if (!Array.isArray(opts.messages) || !opts.messages.length) throw new WorkspaceError('messages 不能为空')
    const headers = { 'Content-Type': 'application/json', Authorization: this.basic() }
    if (opts.userToken) headers['X-User-Token'] = opts.userToken
    let r
    try {
      r = await fetch(this.apiUrl + '/api/open/llm/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(opts), signal: AbortSignal.timeout(120_000)
      })
    } catch (e) {
      throw new WorkspaceError(`连不上平台 ${this.apiUrl}：${e.message}`)
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new WorkspaceError(e.error?.message || `平台返回 HTTP ${r.status}`)
    }
    if (opts.stream) return parseSSE(r.body)
    return r.json()
  }

  /**
   * 文本向量（OpenAI /embeddings 兼容），用平台「模型与 AI」里配置的向量模型
   * opts: { input: string | string[], model?, dimensions?, userToken? }
   * 返回 number[][]，顺序与 input 一致
   */
  async embed(opts = {}) {
    if (!this.clientId || !this.clientSecret) throw new WorkspaceError('缺少应用凭证（YH_CLIENT_ID / YH_CLIENT_SECRET）')
    const { userToken, ...body } = opts
    const headers = { 'Content-Type': 'application/json', Authorization: this.basic() }
    if (userToken) headers['X-User-Token'] = userToken
    let r
    try {
      r = await fetch(this.apiUrl + '/api/open/llm/embeddings', {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000)
      })
    } catch (e) {
      throw new WorkspaceError(`连不上平台 ${this.apiUrl}：${e.message}`)
    }
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new WorkspaceError(data.error?.message || `平台返回 HTTP ${r.status}`)
    return (data.data || []).sort((a, b) => a.index - b.index).map(d => d.embedding)
  }

  /**
   * 文件存储（管理员在「系统设置 → 文件存储」里配置）。key 都是相对本应用目录的路径，如 'courseware/B-05.pptx'
   *   storage.info()                                  → { enabled, private, maxUploadMB, root }
   *   storage.put(key, buffer, { mime, overwrite })   → { key, hash, size, mime }   服务端直接传（经平台签发的凭证直传七牛）
   *   storage.uploadToken({ key, expires, maxSizeMB, mime, overwrite })
   *                                                   → { uploadUrl, token, key, fullKey, expiresAt }  交给浏览器直传：
   *                                                     表单 POST uploadUrl，字段 token、key=fullKey、file
   *   storage.url(key, { expires, filename })         → 下载地址（私有空间带签名，默认 1 小时有效）
   *   storage.get(key)                                → Buffer
   *   storage.stat(key) / storage.list({ prefix, limit, marker }) / storage.remove(key)
   */
  get storage() {
    if (this._storage) return this._storage
    const auth = () => {
      if (!this.clientId || !this.clientSecret) throw new WorkspaceError('缺少应用凭证（YH_CLIENT_ID / YH_CLIENT_SECRET）')
      return { Authorization: this.basic() }
    }
    const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
    const s = {
      info: () => this.call('GET', '/api/open/storage', { headers: auth() }),
      uploadToken: (opts = {}) => this.call('POST', '/api/open/storage/upload-token', { body: opts, headers: auth() }),
      url: async (key, { expires, filename } = {}) => (await this.call('GET', `/api/open/storage/url?${q({ key, expires, filename })}`, { headers: auth() })).url,
      stat: (key) => this.call('GET', `/api/open/storage/stat?${q({ key })}`, { headers: auth() }),
      list: ({ prefix, limit, marker } = {}) => this.call('GET', `/api/open/storage/list?${q({ prefix, limit, marker })}`, { headers: auth() }),
      remove: (key) => this.call('DELETE', `/api/open/storage/object?${q({ key })}`, { headers: auth() }),
      put: async (key, data, { mime = 'application/octet-stream', overwrite, timeoutMs = 600_000 } = {}) => {
        const t = await s.uploadToken({ key, overwrite })
        const form = new FormData()
        form.append('token', t.token)
        form.append('key', t.fullKey)
        form.append('file', new Blob([data], { type: mime }), key.split('/').pop())
        let r
        try {
          r = await fetch(t.uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) })
        } catch (e) {
          throw new WorkspaceError(`连不上文件存储 ${t.uploadUrl}：${e.message}`)
        }
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new WorkspaceError(`上传失败：${j.error || `HTTP ${r.status}`}`)
        return { key: t.key, hash: j.hash, size: j.size, mime: j.mime }
      },
      get: async (key, { timeoutMs = 600_000 } = {}) => {
        const url = await s.url(key)
        let r
        try {
          r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        } catch (e) {
          throw new WorkspaceError(`连不上文件存储：${e.message}`)
        }
        if (!r.ok) throw new WorkspaceError(r.status === 404 ? `文件不存在：${key}` : `下载失败：HTTP ${r.status}`)
        return Buffer.from(await r.arrayBuffer())
      }
    }
    return (this._storage = s)
  }
}

/** 解析 OpenAI SSE：逐条产出对象，[DONE] 结束 */
async function* parseSSE(body) {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true })
    let end
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, end)
      buf = buf.slice(end + 2)
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        try { yield JSON.parse(data) } catch { /* 忽略坏行 */ }
      }
    }
  }
}
