// 企业微信客户端（企业自建应用）：扫码登录 + 企业微信客户端内免登
//   浏览器：企业微信扫码登录页（login.work.weixin.qq.com）
//   企业微信里打开：OAuth2 snsapi_base 静默授权（open.weixin.qq.com），用户无感
// 两种都回调带 code，用应用的 access_token 换成企业内 userid
// 凭证在「管理 → 登录方式 → 企业微信应用」配置；未配置或未启用时 enabled()=false
import { AppError } from './http.js'
import { get as setting } from '../services/settings.js'

const override = (name) => (process.env.NODE_ENV !== 'production' ? process.env[name] : '') || ''
const API = () => override('YH_TEST_WECOM_API') || 'https://qyapi.weixin.qq.com'

const conf = () => setting('wecom')

export async function configured() {
  const c = await conf()
  return !!(c.corpId && c.agentId && c.secret)
}

export async function enabled() {
  const [c, login] = await Promise.all([conf(), setting('login')])
  return !!(login.wecom && c.corpId && c.agentId && c.secret)
}

export async function publicConfig() {
  const c = await conf()
  return { enabled: await enabled(), corpId: c.corpId || '', agentId: String(c.agentId || '') }
}

async function call(path) {
  let r
  try {
    r = await fetch(`${API()}${path}`, { signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    throw new AppError(502, `连不上企业微信：${e.message}`, 5001)
  }
  return r.json().catch(() => ({}))
}

let cached = null // { token, expiresAt, key }

/** 应用 access_token，有效期 2 小时，提前 5 分钟刷新；换了凭证自动作废 */
async function accessToken(c) {
  const key = `${c.corpId}:${c.secret}`
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 300_000) return cached.token
  const d = await call(`/cgi-bin/gettoken?corpid=${encodeURIComponent(c.corpId)}&corpsecret=${encodeURIComponent(c.secret)}`)
  if (d.errcode !== 0 || !d.access_token) throw new AppError(502, `企业微信 gettoken 失败：${d.errmsg || d.errcode}`, 5001)
  cached = { token: d.access_token, expiresAt: Date.now() + (d.expires_in || 7200) * 1000, key }
  return cached.token
}

/**
 * 授权码 → 企业微信成员。c = { corpId, agentId, secret }
 * 返回 { userId, name, avatar, mobile, email }（姓名等取决于应用的通讯录权限，拿不到时用 userid）
 */
export async function userByCode(c, code) {
  if (!c?.corpId || !c?.agentId || !c?.secret) throw new AppError(400, '企业微信未配置：请管理员在「管理 → 登录方式」填写 CorpID、AgentId 和 Secret', 5000)
  const token = await accessToken(c)
  const info = await call(`/cgi-bin/auth/getuserinfo?access_token=${token}&code=${encodeURIComponent(code)}`)
  if (info.errcode !== 0) throw new AppError(401, `企业微信授权失败：${info.errmsg || info.errcode}`, 5002)
  if (!info.userid) throw new AppError(403, '这个微信账号不是本企业的成员', 5003)
  const u = await call(`/cgi-bin/user/get?access_token=${token}&userid=${encodeURIComponent(info.userid)}`)
  const ok = u.errcode === 0
  return {
    userId: info.userid,
    name: (ok && u.name) || info.userid,
    avatar: (ok && u.avatar) || null,
    mobile: (ok && u.mobile) || null,
    email: (ok && (u.biz_mail || u.email)) || null
  }
}

export const loginByCode = async (code) => userByCode(await conf(), code)

// ---------- 应用消息(应用经平台给个人发消息) ----------

/** 应用消息体(纯函数): 有链接用文本卡片, 否则 markdown */
export function appMessage(agentId, userIds, { title, markdown, plain, url }) {
  const base = { touser: userIds.join('|'), agentid: Number(agentId) }
  if (url) return { ...base, msgtype: 'textcard', textcard: { title, description: (plain || markdown).slice(0, 500), url, btntxt: '详情' } }
  return { ...base, msgtype: 'markdown', markdown: { content: `**${title}**\n${markdown}` } }
}

/** 给一批企业微信 userid 发应用消息(一次最多 1000 人) */
export async function sendAppMessage(userIds, msg) {
  const c = await conf()
  const token = await accessToken(c)
  let r
  try {
    r = await fetch(`${API()}/cgi-bin/message/send?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appMessage(c.agentId, userIds, msg)), signal: AbortSignal.timeout(10_000)
    })
  } catch (e) {
    throw new AppError(502, `连不上企业微信：${e.message}`, 5001)
  }
  const d = await r.json().catch(() => ({}))
  if (d.errcode !== 0) throw new AppError(502, `企业微信发消息失败：${d.errmsg || d.errcode}`, 5001)
}

/** 开通向导「测试连接」：凭证对不对、企业可信 IP 配没配。只读。返回 { ok, checks } */
export async function testConnection() {
  const c = await conf()
  if (!c.corpId || !c.agentId || !c.secret) return { ok: false, checks: [{ name: '应用凭证', ok: false, message: '还没填 CorpID、AgentId 和 Secret' }] }
  cached = null
  const checks = []
  let token
  try {
    token = await accessToken(c)
    checks.push({ name: '应用凭证', ok: true, message: 'CorpID / Secret 正确' })
  } catch (e) {
    return { ok: false, checks: [{ name: '应用凭证', ok: false, message: `${e.message}：检查 CorpID 和这个应用的 Secret` }] }
  }
  const a = await call(`/cgi-bin/agent/get?access_token=${token}&agentid=${encodeURIComponent(c.agentId)}`)
  if (a.errcode === 0) checks.push({ name: '应用与可信 IP', ok: true, message: `应用「${a.name || c.agentId}」可用，平台的出口 IP 在可信 IP 里` })
  else if (a.errcode === 60020) checks.push({ name: '企业可信 IP', ok: false, message: `平台的出口 IP 不在「企业可信 IP」里：到应用详情 → 开发者接口 → 企业可信 IP 加上（${a.errmsg || ''}）` })
  else checks.push({ name: 'AgentId', ok: false, message: `${a.errmsg || a.errcode}：检查 AgentId 是不是这个应用的` })
  return { ok: checks.every(x => x.ok), checks }
}
