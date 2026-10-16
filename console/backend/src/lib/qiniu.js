// 七牛云对象存储（Kodo）的最小客户端：上传凭证、私有空间下载地址、管理接口（stat / delete / list）、表单上传
// 不引 SDK：签名规则见七牛文档「上传凭证」「下载凭证」「管理凭证（QBox）」，都是 HMAC-SHA1 + URL 安全的 Base64
import crypto from 'node:crypto'

/** 区域 → 上传 / 管理 / 列举接口的域名 */
export const REGIONS = {
  z0: { label: '华东-浙江', up: 'https://up-z0.qiniup.com', rs: 'https://rs-z0.qiniuapi.com', rsf: 'https://rsf-z0.qiniuapi.com' },
  'cn-east-2': { label: '华东-浙江2', up: 'https://up-cn-east-2.qiniup.com', rs: 'https://rs-cn-east-2.qiniuapi.com', rsf: 'https://rsf-cn-east-2.qiniuapi.com' },
  z1: { label: '华北-河北', up: 'https://up-z1.qiniup.com', rs: 'https://rs-z1.qiniuapi.com', rsf: 'https://rsf-z1.qiniuapi.com' },
  z2: { label: '华南-广东', up: 'https://up-z2.qiniup.com', rs: 'https://rs-z2.qiniuapi.com', rsf: 'https://rsf-z2.qiniuapi.com' },
  na0: { label: '北美-洛杉矶', up: 'https://up-na0.qiniup.com', rs: 'https://rs-na0.qiniuapi.com', rsf: 'https://rsf-na0.qiniuapi.com' },
  as0: { label: '亚太-新加坡', up: 'https://up-as0.qiniup.com', rs: 'https://rs-as0.qiniuapi.com', rsf: 'https://rsf-as0.qiniuapi.com' }
}

/** URL 安全的 Base64（+ → -，/ → _，保留 =） */
export const urlsafe = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
export const hmac = (sk, data) => urlsafe(crypto.createHmac('sha1', sk).update(data).digest())
/** 「空间:文件名」的 EncodedEntryURI */
export const entry = (bucket, key) => urlsafe(`${bucket}:${key}`)

/** 上传凭证：AccessKey:签名:编码后的上传策略。policy 至少要有 scope 和 deadline（秒级时间戳） */
export function uploadToken({ accessKey, secretKey }, policy) {
  const encoded = urlsafe(JSON.stringify(policy))
  return `${accessKey}:${hmac(secretKey, encoded)}:${encoded}`
}

/** 私有空间的下载地址：在公开地址后加 e=过期时间，再对整个地址签名 */
export function privateUrl({ accessKey, secretKey }, publicUrl, deadline) {
  const url = `${publicUrl}${publicUrl.includes('?') ? '&' : '?'}e=${deadline}`
  return `${url}&token=${accessKey}:${hmac(secretKey, url)}`
}

/** 公开地址：域名 + 按段编码的文件名（/ 保留） */
export function publicUrl(domain, key) {
  return `${String(domain).replace(/\/+$/, '')}/${String(key).split('/').map(encodeURIComponent).join('/')}`
}

/** 管理凭证（QBox）：对「路径?查询\n请求体」签名；只有表单请求体才参与签名 */
export function qboxAuth({ accessKey, secretKey }, pathWithQuery, body = '') {
  return `QBox ${accessKey}:${hmac(secretKey, `${pathWithQuery}\n${body}`)}`
}

async function manage(cfg, host, method, pathWithQuery) {
  const r = await fetch(host + pathWithQuery, {
    method,
    headers: { Authorization: qboxAuth(cfg, pathWithQuery), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    signal: AbortSignal.timeout(20000)
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text.slice(0, 200) } }
  if (!r.ok) {
    const err = new Error(data?.error || `七牛接口 HTTP ${r.status}`)
    err.status = r.status
    throw err
  }
  return data
}

const hosts = (cfg) => {
  const h = REGIONS[cfg.region]
  if (!h && !cfg.uploadHost) throw new Error(`不认识的七牛区域：${cfg.region}`)
  return { up: cfg.uploadHost || h.up, rs: h?.rs || 'https://rs.qiniuapi.com', rsf: h?.rsf || 'https://rsf.qiniuapi.com' }
}

/** 文件信息：{ fsize, hash, mimeType, putTime(100 纳秒) }；文件不存在时七牛返回 612 */
export const stat = (cfg, key) => manage(cfg, hosts(cfg).rs, 'GET', `/stat/${entry(cfg.bucket, key)}`)
export const remove = (cfg, key) => manage(cfg, hosts(cfg).rs, 'POST', `/delete/${entry(cfg.bucket, key)}`)
export function list(cfg, { prefix = '', limit = 100, marker = '' } = {}) {
  const q = new URLSearchParams({ bucket: cfg.bucket, prefix, limit: String(limit), ...(marker ? { marker } : {}) })
  return manage(cfg, hosts(cfg).rsf, 'POST', `/list?${q}`)
}

/** 表单上传（平台自己用：测试连接、小文件）。应用的大文件用上传凭证直接传七牛，不经过平台 */
export async function put(cfg, key, buffer, { mime = 'application/octet-stream', deadline } = {}) {
  const token = uploadToken(cfg, { scope: `${cfg.bucket}:${key}`, deadline: deadline || Math.floor(Date.now() / 1000) + 3600 })
  const form = new FormData()
  form.append('token', token)
  form.append('key', key)
  form.append('file', new Blob([buffer], { type: mime }), key.split('/').pop())
  const r = await fetch(hosts(cfg).up, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const err = new Error(data.error || `七牛上传 HTTP ${r.status}`); err.status = r.status; throw err }
  return data // { hash, key }
}

export const uploadHost = (cfg) => hosts(cfg).up
