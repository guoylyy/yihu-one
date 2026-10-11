// 钉钉相关：客户端判断、免登 code、扫码 OAuth 地址
export function isDingTalk() {
  return /DingTalk/i.test(navigator.userAgent)
}

/** 钉钉客户端内取免登授权码 */
export async function requestInAppAuthCode(corpId) {
  const mod = await import('dingtalk-jsapi')
  const dd = mod.default || mod
  return new Promise((resolve, reject) => {
    const run = () => {
      dd.runtime.permission.requestAuthCode({
        corpId,
        onSuccess: res => resolve(res.code),
        onFail: err => reject(new Error((err && (err.errorMessage || err.message)) || '获取钉钉授权码失败'))
      })
    }
    if (typeof dd.ready === 'function') dd.ready(run)
    else run()
    if (typeof dd.error === 'function') {
      dd.error(err => reject(new Error((err && err.errorMessage) || '钉钉 JSAPI 初始化失败')))
    }
  })
}

export function buildScanLoginUrl(clientId, state) {
  const redirect = window.location.origin + '/auth/dingtalk/callback'
  const q = new URLSearchParams({
    redirect_uri: redirect,
    response_type: 'code',
    client_id: clientId,
    scope: 'openid',
    state,
    prompt: 'consent'
  })
  return 'https://login.dingtalk.com/oauth2/auth?' + q.toString()
}

const REDIRECT_KEY = 'yh_login_redirect'
const STATE_KEY = 'yh_login_state'

export function saveLoginRedirect(redirect, state) {
  try {
    sessionStorage.setItem(REDIRECT_KEY, redirect || '/')
    sessionStorage.setItem(STATE_KEY, state || '')
  } catch { /* ignore */ }
}

export function takeLoginRedirect() {
  try {
    const r = sessionStorage.getItem(REDIRECT_KEY) || '/'
    const s = sessionStorage.getItem(STATE_KEY) || ''
    sessionStorage.removeItem(REDIRECT_KEY)
    sessionStorage.removeItem(STATE_KEY)
    return { redirect: r, state: s }
  } catch {
    return { redirect: '/', state: '' }
  }
}

/** redirect 只允许站内路径，防开放跳转 */
export function safeRedirect(r) {
  if (typeof r !== 'string' || !r.startsWith('/') || r.startsWith('//')) return '/'
  if (r.startsWith('/login') || r.startsWith('/auth/')) return '/'
  return r
}
