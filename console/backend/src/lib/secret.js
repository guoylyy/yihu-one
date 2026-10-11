// 敏感配置加密(AES-256-GCM): 模型 API Key、系统设置里的密码项
// 密钥取 SECRET_KEY(yh init 自动生成); 未配置时由 JWT_SECRET 派生。更换密钥后已存的密钥需重新填写
import crypto from 'node:crypto'

function key() {
  const raw = process.env.SECRET_KEY || process.env.JWT_SECRET
  if (!raw) throw new Error('未配置 SECRET_KEY / JWT_SECRET, 无法加密')
  return crypto.createHash('sha256').update(`yh-one:${raw}`).digest()
}

export function encryptJson(obj) {
  if (obj == null) return null
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

export function decryptJson(s) {
  if (!s) return {}
  const [v, iv, tag, data] = s.split('.')
  if (v !== 'v1') throw new Error('凭证格式不支持')
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'))
}

/** 给界面看的打码版本: 只告诉有没有填, 不回显 */
export function maskSecret(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) out[k] = v ? '******' : ''
  return out
}
