// 文件存储（七牛云）：平台统一配置，应用经开放接口用
//   - 应用只能读写自己的目录：<前缀>apps/<应用 code>/<key>；接口里收发的 key 都是相对这个目录的
//   - 上传：平台发限时的上传凭证，应用（服务端或浏览器）直接传到七牛，大文件不经过平台
//   - 下载：私有空间由平台签发限时地址；公开空间直接给地址
// 配置在系统设置的 storage 组（services/settings.js），即改即生效
import * as qn from '../lib/qiniu.js'
import { get as getSettings } from './settings.js'
import { assertAdmin } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { AppError, badRequest, notFound } from '../lib/http.js'

const MB = 1024 * 1024

/** 当前配置；没启用或没配全时抛 503，告诉应用找管理员 */
export async function config({ allowDisabled = false } = {}) {
  const s = await getSettings('storage')
  if (!s.enabled && !allowDisabled) throw new AppError(503, '平台没有启用文件存储，请管理员在「管理 → 系统设置 → 文件存储」里配置', 1005)
  const missing = [['accessKey', 'AccessKey'], ['secretKey', 'SecretKey'], ['bucket', '存储空间'], ['domain', '下载域名']].filter(([k]) => !s[k]).map(([, l]) => l)
  if (missing.length) throw new AppError(503, `文件存储还没配全：${missing.join('、')}`, 1005)
  if (!qn.REGIONS[s.region] && !s.uploadHost) throw new AppError(503, `文件存储的区域写错了：${s.region}（可选 ${Object.keys(qn.REGIONS).join(' / ')}）`, 1005)
  const prefix = String(s.keyPrefix || '').replace(/^\/+/, '')
  return { ...s, keyPrefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix, maxUploadMB: Number(s.maxUploadMB) || 500 }
}

/** 应用传来的 key：相对路径，不能越出自己的目录 */
export function cleanKey(key, { allowEmpty = false } = {}) {
  const k = String(key ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/')
  if (!k && allowEmpty) return ''
  if (!k) throw badRequest('key 不能为空')
  if (k.length > 512) throw badRequest('key 太长（最多 512 个字符）')
  if (k.split('/').some(seg => seg === '..' || seg === '.')) throw badRequest('key 里不能有 . 或 .. 这样的路径段')
  if (/[\u0000-\u001f\u007f]/.test(k)) throw badRequest('key 里不能有控制字符')
  return k
}
export const appRoot = (cfg, app) => `${cfg.keyPrefix}apps/${app.code}/`
const clampSeconds = (v, def, max) => Math.min(Math.max(Math.round(Number(v) || def), 60), max)

/** 七牛的错误换成人能看懂的话 */
function explain(e) {
  if (e instanceof AppError) return e
  const map = { 401: '七牛拒绝了请求：检查 AccessKey / SecretKey 是否正确', 403: '七牛拒绝了请求：这对密钥没有这个空间的权限', 612: '文件不存在', 631: '七牛的存储空间不存在：检查空间名称和区域', 614: '文件已存在' }
  const status = e.status === 612 ? 404 : e.status === 614 ? 409 : 502
  return new AppError(status, map[e.status] || `文件存储出错：${e.message}`, status === 404 ? 1004 : 1006)
}

export async function info(app) {
  const s = await getSettings('storage')
  if (!s.enabled) return { enabled: false }
  const cfg = await config()
  return { enabled: true, provider: 'qiniu', private: !!cfg.privateBucket, maxUploadMB: cfg.maxUploadMB, root: `apps/${app.code}/` }
}

/**
 * 上传凭证：应用拿去直接传七牛（表单上传：POST uploadUrl，字段 token、key、file）
 *   body: { key, expires?(秒，默认 1 小时), maxSizeMB?, mime?(限定类型，如 image/*), overwrite?(默认 true) }
 */
export async function uploadToken(app, body = {}) {
  const cfg = await config()
  const key = cleanKey(body.key)
  const full = appRoot(cfg, app) + key
  const expires = clampSeconds(body.expires, 3600, 24 * 3600)
  const deadline = Math.floor(Date.now() / 1000) + expires
  const maxMB = Math.min(Number(body.maxSizeMB) || cfg.maxUploadMB, cfg.maxUploadMB)
  const policy = {
    scope: body.overwrite === false ? cfg.bucket : `${cfg.bucket}:${full}`,
    deadline,
    fsizeLimit: Math.round(maxMB * MB),
    returnBody: '{"key":$(key),"hash":$(etag),"size":$(fsize),"mime":$(mimeType)}',
    ...(body.overwrite === false ? { insertOnly: 1, saveKey: full, forceSaveKey: true } : {}),
    ...(body.mime ? { mimeLimit: String(body.mime).slice(0, 200) } : {})
  }
  return { uploadUrl: qn.uploadHost(cfg), token: qn.uploadToken(cfg, policy), key, fullKey: full, expiresAt: new Date(deadline * 1000).toISOString(), maxSizeMB: maxMB }
}

/** 下载地址：私有空间带签名和过期时间；filename 给了就让浏览器按这个名字下载 */
export async function downloadUrl(app, { key, expires, filename } = {}) {
  const cfg = await config()
  const full = appRoot(cfg, app) + cleanKey(key)
  let url = qn.publicUrl(cfg.domain, full)
  if (filename) url += `?attname=${encodeURIComponent(String(filename).slice(0, 200))}`
  if (!cfg.privateBucket) return { url, expiresAt: null }
  const deadline = Math.floor(Date.now() / 1000) + clampSeconds(expires, 3600, 7 * 24 * 3600)
  return { url: qn.privateUrl(cfg, url, deadline), expiresAt: new Date(deadline * 1000).toISOString() }
}

export async function stat(app, key) {
  const cfg = await config()
  const k = cleanKey(key)
  try {
    const r = await qn.stat(cfg, appRoot(cfg, app) + k)
    return { key: k, size: r.fsize, mime: r.mimeType, hash: r.hash, uploadedAt: new Date(Math.floor(r.putTime / 10000)).toISOString() }
  } catch (e) { throw explain(e) }
}

export async function remove(app, key) {
  const cfg = await config()
  const k = cleanKey(key)
  try { await qn.remove(cfg, appRoot(cfg, app) + k) } catch (e) { if (e.status !== 612) throw explain(e) }
  return { ok: true, key: k }
}

export async function list(app, { prefix, limit, marker } = {}) {
  const cfg = await config()
  const root = appRoot(cfg, app)
  try {
    const r = await qn.list(cfg, { prefix: root + cleanKey(prefix, { allowEmpty: true }), limit: Math.min(Math.max(Number(limit) || 100, 1), 1000), marker: marker || '' })
    return {
      items: (r.items || []).map(i => ({ key: i.key.slice(root.length), size: i.fsize, mime: i.mimeType, hash: i.hash, uploadedAt: new Date(Math.floor(i.putTime / 10000)).toISOString() })),
      marker: r.marker || null
    }
  } catch (e) { throw explain(e) }
}

/** 管理员「测试连接」：传一个小文件 → 查信息 → 用下载地址取回 → 删掉，逐步报告 */
export async function testConnection(ctx) {
  assertAdmin(ctx)
  const steps = []
  const step = async (name, fn) => {
    try { const detail = await fn(); steps.push({ name, ok: true, detail: detail || '' }); return true } catch (e) { steps.push({ name, ok: false, detail: explain(e).message }); return false }
  }
  let cfg
  if (!(await step('读取配置', async () => { cfg = await config({ allowDisabled: true }); return `${cfg.bucket} · ${qn.REGIONS[cfg.region]?.label || cfg.uploadHost} · ${cfg.privateBucket ? '私有' : '公开'}空间` }))) return { ok: false, steps }
  const key = `${cfg.keyPrefix}_healthcheck/${Date.now()}.txt`
  const body = `yihu-one storage check ${new Date().toISOString()}`
  const uploaded = await step('上传测试文件', async () => { await qn.put(cfg, key, Buffer.from(body), { mime: 'text/plain' }); return key })
  if (uploaded) {
    await step('查询文件信息', async () => { const r = await qn.stat(cfg, key); return `${r.fsize} 字节` })
    await step('用下载地址取回', async () => {
      let url = qn.publicUrl(cfg.domain, key)
      if (cfg.privateBucket) url = qn.privateUrl(cfg, url, Math.floor(Date.now() / 1000) + 300)
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error(`下载域名返回 HTTP ${r.status}：检查下载域名是否绑定在这个空间、私有空间开关是否和七牛一致`)
      const text = await r.text()
      if (text !== body) throw new Error('取回的内容不对：下载域名可能不是这个空间的')
      return '内容一致'
    })
    await step('删除测试文件', async () => { await qn.remove(cfg, key) })
  }
  const ok = steps.every(s => s.ok)
  audit(ctx, 'storage.test', { entityType: 'setting', entityId: 'storage', detail: { ok, failed: steps.filter(s => !s.ok).map(s => s.name) } })
  return { ok, steps }
}
