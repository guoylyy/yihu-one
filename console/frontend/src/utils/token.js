// token 存储：统一入口，方便以后换成 cookie / sessionStorage
const KEY = 'yh_token'

export function getToken() {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}
export function setToken(token) {
  try { localStorage.setItem(KEY, token) } catch { /* ignore */ }
}
export function clearToken() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
