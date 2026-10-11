// 飞书（Lark）开放平台客户端（企业自建应用）：网页登录 + 飞书客户端内免登
// 两种场景都走 OAuth 授权码：浏览器里是扫码 / 账号确认页；在飞书客户端里打开时授权页静默通过（免登）
// 凭证在「管理 → 登录方式 → 飞书应用」配置；未配置或未启用时 enabled()=false
import { AppError } from './http.js'
import { get as setting } from '../services/settings.js'

// 只在非生产环境允许指到模拟服务（自测用）
const override = (name) => (process.env.NODE_ENV !== 'production' ? process.env[name] : '') || ''
const API = () => override('YH_TEST_FEISHU_API') || 'https://open.feishu.cn'
const ACCOUNTS = () => override('YH_TEST_FEISHU_ACCOUNTS') || 'https://accounts.feishu.cn'

const conf = () => setting('feishu')

export async function configured() {
  const c = await conf()
  return !!(c.appId && c.appSecret)
}

export async function enabled() {
  const [c, login] = await Promise.all([conf(), setting('login')])
  return !!(login.feishu && c.appId && c.appSecret)
}

export async function publicConfig() {
  const c = await conf()
  return { enabled: await enabled(), appId: c.appId || '', authorizeUrl: `${ACCOUNTS()}/open-apis/authen/v1/authorize` }
}

/** 授权地址（前端也会自己拼，这里给自测和文档用） */
export function authorizeUrl(appId, redirectUri, state) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: 'code', state: state || '' })
  return `${ACCOUNTS()}/open-apis/authen/v1/authorize?${q}`
}

async function call(url, init) {
  let r
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    throw new AppError(502, `连不上飞书：${e.message}`, 5001)
  }
  return r.json().catch(() => ({}))
}

/**
 * 授权码 → 飞书用户。c = { appId, appSecret }
 * 返回 { openId, unionId, userId, name, avatar, mobile, email }
 */
export async function userByCode(c, code, redirectUri) {
  if (!c?.appId || !c?.appSecret) throw new AppError(400, '飞书未配置：请管理员在「管理 → 登录方式」填写飞书 App ID 和 App Secret', 5000)
  const tok = await call(`${API()}/open-apis/authen/v2/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: c.appId, client_secret: c.appSecret, code, redirect_uri: redirectUri })
  })
  if (tok.code !== 0 || !tok.access_token) throw new AppError(401, `飞书授权失败：${tok.error_description || tok.msg || tok.error || '无效的授权码'}`, 5002)
  const me = await call(`${API()}/open-apis/authen/v1/user_info`, { headers: { Authorization: `Bearer ${tok.access_token}` } })
  const d = me.data
  if (me.code !== 0 || !d?.open_id) throw new AppError(401, `获取飞书用户信息失败：${me.msg || ''}`, 5002)
  return {
    openId: d.open_id, unionId: d.union_id || null, userId: d.user_id || null,
    name: d.name || d.en_name || '飞书用户', avatar: d.avatar_url || d.avatar_middle || null,
    mobile: (d.mobile || '').replace(/^\+86/, '') || null, email: d.enterprise_email || d.email || null
  }
}

export const loginByCode = async (code, redirectUri) => userByCode(await conf(), code, redirectUri)

// ---------- 通讯录同步（「用户与部门 → 从飞书同步」用）----------
// 应用还要在飞书开发者后台开通通讯录权限：获取部门组织架构信息、读取成员基本信息；
// 手机号 / 邮箱 / 工号是敏感字段，要单独开通才有值

async function callApi(url, init) {
  const r = await call(url, init)
  if (r.code !== 0) throw new AppError(502, `飞书接口报错：${r.msg || '请检查应用的通讯录权限'}`, 5003)
  return r
}

let tenantTok = null // { token, exp }

/** 企业自建应用 tenant_access_token（缓存到过期前 5 分钟；c 可显式传，测试用） */
export async function tenantToken(c) {
  c = c || await conf()
  if (!c.appId || !c.appSecret) throw new AppError(400, '飞书未配置：请管理员在「管理 → 登录方式」填写飞书 App ID 和 App Secret', 5000)
  if (tenantTok?.appId === c.appId && tenantTok.token && Date.now() < tenantTok.exp) return tenantTok.token
  const r = await callApi(`${API()}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: c.appId, app_secret: c.appSecret })
  })
  tenantTok = { appId: c.appId, token: r.tenant_access_token, exp: Date.now() + ((r.expire || 3600) - 300) * 1000 }
  return tenantTok.token
}

/** 递归拉取根部门(0)以下全部部门，返回 [{ deptId, name, parentId }] */
export async function listAllDepartments(c) {
  c = c || await conf()
  const out = []
  const walk = async (deptId) => {
    let pageToken = ''
    for (;;) {
      const q = new URLSearchParams({ page_size: '50', fetch_child: 'false', ...(pageToken ? { page_token: pageToken } : {}) })
      const r = await callApi(`${API()}/open-apis/contact/v3/departments/${deptId}/children?${q}`, { headers: { Authorization: `Bearer ${await tenantToken(c)}` } })
      for (const d of r.data?.items || []) {
        if (d.status?.is_deleted) continue
        out.push({ deptId: d.open_department_id, name: d.name, parentId: d.parent_open_department_id || deptId })
        await walk(d.open_department_id)
      }
      if (!r.data?.has_more || !r.data?.page_token) break
      pageToken = r.data.page_token
    }
  }
  await walk('0')
  return out
}

/** 部门下成员（分页拉全）。字段按联系人信息归一：openId/unionId/name/avatar/mobile/email/jobNumber/title/leaderUserId */
export async function listDeptUsers(deptId, c) {
  c = c || await conf()
  const out = []
  let pageToken = ''
  for (;;) {
    const q = new URLSearchParams({ department_id: deptId, page_size: '50', user_id_type: 'open_id', ...(pageToken ? { page_token: pageToken } : {}) })
    const r = await callApi(`${API()}/open-apis/contact/v3/users/find_by_department?${q}`, { headers: { Authorization: `Bearer ${await tenantToken(c)}` } })
    for (const u of r.data?.items || []) out.push({
      openId: u.open_id, unionId: u.union_id || null, name: u.name || u.en_name || '飞书用户',
      avatar: u.avatar?.avatar_240 || u.avatar?.avatar_72 || null,
      mobile: (u.mobile || '').replace(/^\+86/, '') || null, email: u.enterprise_email || u.email || null,
      jobNumber: u.job_number || null, title: u.job_title || null, leaderUserId: u.leader_user_id || null
    })
    if (!r.data?.has_more || !r.data?.page_token) break
    pageToken = r.data.page_token
  }
  return out
}
