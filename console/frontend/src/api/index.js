// 统一 axios 实例
// - 自动带 Authorization
// - 响应 { code: 0, data } 解包为 data；code !== 0 时 ElMessage 报错并 reject
// - 401 清 token，跳登录（带 redirect）
// 单个请求可传 { silent: true } 关闭错误提示
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { getToken, clearToken } from '@/utils/token'

const http = axios.create({
  baseURL: '/api',
  timeout: 30000
})

let unauthorizedHandler = null
/** main.js 里注册：收到 401 时做什么（跳登录） */
export function onUnauthorized(fn) {
  unauthorizedHandler = fn
}

let lastAuthNotice = 0
function handleUnauthorized(message) {
  clearToken()
  const now = Date.now()
  if (now - lastAuthNotice > 3000) {
    lastAuthNotice = now
    ElMessage.warning(message || '登录已过期，请重新登录')
  }
  if (unauthorizedHandler) unauthorizedHandler()
}

http.interceptors.request.use(config => {
  const token = getToken()
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

http.interceptors.response.use(
  res => {
    const body = res.data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data
      const err = new Error(body.message || '请求失败')
      err.code = body.code
      err.status = res.status
      if (!res.config.silent) ElMessage.error(err.message)
      return Promise.reject(err)
    }
    return body
  },
  error => {
    const status = error.response?.status
    const body = error.response?.data
    const message = (body && body.message) || (status ? `请求失败（${status}）` : (error.code === 'ECONNABORTED' ? '请求超时，请稍后重试' : '网络异常，请检查连接'))
    const err = new Error(message)
    err.status = status
    err.code = body?.code
    if (status === 401 && !error.config?.skipAuthRedirect) {
      handleUnauthorized(body?.message)
    } else if (!error.config?.silent) {
      ElMessage.error(message)
    }
    return Promise.reject(err)
  }
)

/** 把 undefined / '' 参数去掉，避免后端收到 "undefined" */
export function cleanParams(params) {
  const out = {}
  if (!params) return out
  Object.keys(params).forEach(k => {
    const v = params[k]
    if (v !== undefined && v !== null && v !== '') out[k] = v
  })
  return out
}

export const get = (url, params, config = {}) => http.get(url, { ...config, params: cleanParams(params) })
export const post = (url, data, config) => http.post(url, data ?? {}, config)
export const put = (url, data, config) => http.put(url, data ?? {}, config)
export const del = (url, config) => http.delete(url, config)

export default http
