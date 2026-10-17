// 钉钉开放平台客户端(企业内部应用)
// 用到的能力: 扫码登录 / 客户端内免登 / 通讯录同步
// 凭证在「管理 → 登录方式 → 钉钉」配置, 未配置或未启用时 enabled()=false
import { AppError } from './http.js'
import { get as setting } from '../services/settings.js'

const OAPI = 'https://oapi.dingtalk.com'
const API = 'https://api.dingtalk.com'

const conf = () => setting('dingtalk')

/** 凭证齐全(可以同步通讯录) */
export async function configured() {
  const c = await conf()
  return !!(c.clientId && c.clientSecret)
}

/** 可以用钉钉登录: 凭证齐全且在「登录方式」里打开 */
export async function enabled() {
  const [c, login] = await Promise.all([conf(), setting('login')])
  return !!(login.dingtalk && c.clientId && c.clientSecret)
}

export async function publicConfig() {
  const c = await conf()
  return { enabled: await enabled(), clientId: c.clientId || '', corpId: c.corpId || '' }
}

let cachedToken = null // { token, expiresAt, clientId }

/** 企业内部应用 access_token, 有效期 2 小时, 提前 5 分钟刷新 */
async function appAccessToken() {
  const c = await conf()
  // 后台换了应用凭证后, 旧 token 作废
  if (cachedToken && cachedToken.clientId === c.clientId && cachedToken.expiresAt > Date.now() + 300_000) return cachedToken.token
  const url = `${OAPI}/gettoken?appkey=${encodeURIComponent(c.clientId)}&appsecret=${encodeURIComponent(c.clientSecret)}`
  const data = await (await fetch(url)).json()
  if (data.errcode !== 0) throw new AppError(502, `钉钉 gettoken 失败: ${data.errmsg}`, 5001)
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000, clientId: c.clientId }
  return cachedToken.token
}

// 钉钉接口限流: 单应用每秒 20 次(超了报 90018)。本进程内串行排队, 每次间隔 70ms(约 14 次/秒)
const MIN_GAP_MS = 70
let queue = Promise.resolve()
function throttle() {
  const slot = queue.then(() => new Promise(r => setTimeout(r, MIN_GAP_MS)))
  queue = slot
  return slot
}
const THROTTLED = new Set([90018, 90002, 88])

/** 调旧版 topapi(oapi), 统一处理 errcode; 触发限流时退避重试 */
/** 给可信应用的 access_token（开放接口 /api/open/channel-token 用）：{ token, expiresAt } */
export async function accessTokenInfo() {
  const c = await conf()
  if (!c.clientId || !c.clientSecret) throw new AppError(400, '钉钉未配置：请管理员在「管理 → 登录方式」填写钉钉应用的 Client ID 和 Client Secret', 5000)
  const token = await appAccessToken()
  return { token, expiresAt: new Date(cachedToken.expiresAt) }
}

async function topapi(path, body) {
  const token = await appAccessToken()
  for (let attempt = 0; ; attempt++) {
    await throttle()
    const resp = await fetch(`${OAPI}${path}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    })
    const data = await resp.json()
    if (data.errcode === 0) return data.result ?? data
    const sub = Number(/subcode=(\d+)/.exec(data.errmsg || '')?.[1])
    if (attempt < 4 && (THROTTLED.has(data.errcode) || THROTTLED.has(sub))) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }
    throw new AppError(502, `钉钉 ${path} 失败: ${data.errmsg}`, 5001)
  }
}

// ---------- 工作通知(应用经平台给个人发消息) ----------

/** 工作通知消息体(纯函数): 有链接用 action_card(带「查看详情」), 否则 markdown */
export function workNoticeMsg({ title, markdown, url }) {
  if (url) return { msgtype: 'action_card', action_card: { title, markdown: `#### ${title}\n\n${markdown}`, single_title: '查看详情', single_url: url } }
  return { msgtype: 'markdown', markdown: { title, text: `#### ${title}\n\n${markdown}` } }
}

/** 能发工作通知: 凭证齐全且填了 AgentId */
export async function canNotify() {
  const c = await conf()
  return !!(c.clientId && c.clientSecret && c.agentId)
}

/** 给一批钉钉 userid 发工作通知(一次最多 100 人) */
export async function sendWorkNotice(userIds, msg) {
  const c = await conf()
  await topapi('/topapi/message/corpconversation/asyncsend_v2', {
    agent_id: Number(c.agentId), userid_list: userIds.join(','), msg: workNoticeMsg(msg)
  })
}

async function ensureEnabled() {
  if (!(await configured())) throw new AppError(400, '钉钉未配置：请管理员在「管理 → 登录方式」填写钉钉 Client ID 和 Client Secret', 5000)
}

/**
 * 扫码登录: authCode → 用户 accessToken → unionId → 企业内 userid
 * 返回 { userid, unionId, nick, avatarUrl, mobile }
 */
export async function userByScanCode(authCode) {
  await ensureEnabled()
  const tokenResp = await fetch(`${API}/v1.0/oauth2/userAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: (await conf()).clientId,
      clientSecret: (await conf()).clientSecret,
      code: authCode,
      grantType: 'authorization_code'
    })
  })
  const tok = await tokenResp.json()
  if (!tok.accessToken) throw new AppError(401, `钉钉授权失败: ${tok.message || '无效的授权码'}`, 5002)
  const me = await (await fetch(`${API}/v1.0/contact/users/me`, {
    headers: { 'x-acs-dingtalk-access-token': tok.accessToken }
  })).json()
  if (!me.unionId) throw new AppError(401, `获取钉钉用户信息失败: ${me.message || ''}`, 5002)
  const r = await topapi('/topapi/user/getbyunionid', { unionid: me.unionId })
  if (!r.userid) throw new AppError(403, '该钉钉账号不在本企业通讯录中', 5003)
  return { userid: r.userid, unionId: me.unionId, nick: me.nick, avatarUrl: me.avatarUrl, mobile: me.mobile }
}

/** 钉钉客户端内免登: requestAuthCode 拿到的 code → userid */
export async function userByInAppCode(code) {
  await ensureEnabled()
  const r = await topapi('/topapi/v2/user/getuserinfo', { code })
  if (!r.userid) throw new AppError(401, '钉钉免登失败', 5002)
  return { userid: r.userid, unionId: r.unionid, nick: r.name }
}

/** 用户详情: name/avatar/title/job_number/dept_id_list/leader_in_dept/mobile/unionid */
export async function getUser(userid) {
  return topapi('/topapi/v2/user/get', { userid, language: 'zh_CN' })
}

/** 递归拉取全部部门(根部门 id=1) */
export async function listAllDepartments() {
  const out = []
  const walk = async (deptId) => {
    const subs = await topapi('/topapi/v2/department/listsub', { dept_id: deptId })
    for (const d of subs || []) {
      out.push({ dept_id: d.dept_id, name: d.name, parent_id: d.parent_id })
      await walk(d.dept_id)
    }
  }
  await walk(1)
  return out
}

/** 部门下用户详情(分页拉全) */
export async function listDeptUsers(deptId) {
  const out = []
  let cursor = 0
  for (;;) {
    const r = await topapi('/topapi/v2/user/list', { dept_id: deptId, cursor, size: 100 })
    out.push(...(r.list || []))
    if (!r.has_more) break
    cursor = r.next_cursor
  }
  return out
}

/**
 * 开通向导「测试连接」：凭证对不对、通讯录权限有没有开、CorpId / AgentId 填没填。只读，不改任何东西
 * 返回 { ok, checks: [{ name, ok, message }] }（ok = 凭证能用，登录就能用）
 */
export async function testConnection() {
  const c = await conf()
  if (!c.clientId || !c.clientSecret) return { ok: false, checks: [{ name: '应用凭证', ok: false, message: '还没填 Client ID 和 Client Secret' }] }
  cachedToken = null
  const checks = []
  try {
    await appAccessToken()
    checks.push({ name: '应用凭证', ok: true, message: 'Client ID / Client Secret 正确' })
  } catch (e) {
    return { ok: false, checks: [{ name: '应用凭证', ok: false, message: `${e.message}：检查 Client ID / Client Secret 是不是同一个应用的` }] }
  }
  try {
    await topapi('/topapi/v2/department/listsub', { dept_id: 1 })
    checks.push({ name: '通讯录权限', ok: true, message: '能读部门，可以从钉钉同步通讯录' })
  } catch (e) {
    checks.push({ name: '通讯录权限', ok: false, message: `${e.message}（只影响同步通讯录，不影响登录）：开通「通讯录部门信息读权限」「通讯录部门成员读权限」` })
  }
  checks.push(c.corpId ? { name: 'CorpId', ok: true, message: '已填' } : { name: 'CorpId', ok: false, message: '没填：在钉钉客户端里打开平台时的免登要用' })
  checks.push(c.agentId ? { name: 'AgentId', ok: true, message: '已填，可以发工作通知（简报推送）' } : { name: 'AgentId', ok: false, message: '没填：给个人推送简报、消息要用（不影响登录）' })
  return { ok: true, checks }
}
