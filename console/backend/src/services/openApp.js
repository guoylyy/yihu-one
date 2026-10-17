// 给应用的开放接口(应用凭证): 应用自身信息(所属空间、品牌)、给个人发消息
//   GET  /api/open/app      应用插在哪个空间、平台(或空间)的名称 / LOGO / 主题, 应用据此跟随平台外观、限定空间
//   POST /api/open/notify   经平台已配置的钉钉 / 飞书 / 企业微信给指定的人发消息(只有管理员安装或登记的可信应用能用)
//   GET  /api/open/channel-token?provider=dingtalk|feishu  平台登录方式里那个钉钉 / 飞书应用的 access_token(只给可信应用)
import prisma from '../lib/prisma.js'
import { badRequest, forbidden } from '../lib/http.js'
import { get as setting, publicConfig } from './settings.js'
import { spacesOfApp, spaceBrief, spaceBrand } from './spaces.js'
import * as dingtalk from '../lib/dingtalk.js'
import * as feishu from '../lib/feishu.js'
import * as wecom from '../lib/wecom.js'
import { audit } from '../lib/audit.js'

const MAX_USERS = 100

/** 站内路径(预设 LOGO 如 /brand/yihu/logo-mark.svg)补成平台的完整地址; data URL 和外部地址原样 */
export function absoluteUrl(u, base) {
  if (!u) return ''
  return u.startsWith('/') && !u.startsWith('//') ? `${String(base || '').replace(/\/+$/, '')}${u}` : u
}

/** 品牌: 空间设置了自己的 VI 用空间的, 否则用平台的 */
export function mergeBrand(platform, space, base) {
  const theme = space?.theme || platform.theme
  return {
    name: space?.name || platform.workspaceName,
    logo: absoluteUrl(space?.logo || platform.logo || theme?.logo || '', base),
    theme: theme ? { preset: theme.preset, tokens: theme.tokens } : null
  }
}

export async function appInfo(app) {
  const [cfg, general, space, spaceVi] = await Promise.all([publicConfig(), setting('general'), spaceBrief(app.spaceId), spaceBrand(app.spaceId)])
  const spaces = await Promise.all(spacesOfApp(app).map(spaceBrief))
  return {
    code: app.code,
    name: app.name,
    icon: app.icon || null,
    space,
    spaces,
    platformUrl: general.publicBaseUrl || '',
    brand: mergeBrand(cfg, spaceVi, general.publicBaseUrl)
  }
}

/** 按每个人绑定的账号选渠道: 钉钉(要配 AgentId) → 飞书 → 企业微信; 都不行返回原因 */
export function pickChannel(u, can) {
  if (can.dingtalk && u.dingUserId) return { channel: 'dingtalk', id: u.dingUserId }
  if (can.feishu && u.feishuOpenId) return { channel: 'feishu', id: u.feishuOpenId }
  if (can.wecom && u.wecomUserId) return { channel: 'wecom', id: u.wecomUserId }
  return { channel: null, reason: '没有绑定可发消息的钉钉 / 飞书 / 企业微信账号，或平台未配置发消息' }
}

/** 校验并规整请求体(纯函数) */
export function normalizeNotify(body) {
  const b = body || {}
  const userIds = [...new Set((Array.isArray(b.userIds) ? b.userIds : []).map(Number).filter(n => Number.isInteger(n) && n > 0))]
  if (!userIds.length) throw badRequest('userIds 不能为空(平台用户 id 数组)')
  if (userIds.length > MAX_USERS) throw badRequest(`一次最多发给 ${MAX_USERS} 人`)
  const title = String(b.title || '').trim().slice(0, 80)
  const markdown = String(b.content || '').trim().slice(0, 2000)
  if (!title) throw badRequest('title 不能为空')
  if (!markdown) throw badRequest('content 不能为空')
  const url = b.url ? String(b.url).trim() : ''
  if (url && !/^https?:\/\/\S+$/.test(url)) throw badRequest('url 须为 http(s) 地址')
  const plain = markdown.replace(/[*_`#>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  return { userIds, msg: { title, markdown, plain, url: url || null } }
}

/**
 * 平台登录方式里配的钉钉 / 飞书企业内部应用的 access_token，可信应用拿去直接调钉钉 / 飞书的开放接口（比如考勤），
 * 不用在应用里再配一遍密钥（密钥不出平台，给的是 2 小时内有效的 token）。能调哪些接口看管理员给那个应用开了哪些权限。
 * 企业微信每个系统应用（打卡、审批…）的 Secret 不一样，不在这里给
 */
const CHANNEL_TOKEN = { dingtalk: () => dingtalk.accessTokenInfo(), feishu: () => feishu.tenantTokenInfo() }
export async function channelToken(app, provider) {
  if (!app.trusted) throw forbidden('只有管理员安装或登记的应用能用平台的钉钉 / 飞书凭证')
  const get = CHANNEL_TOKEN[String(provider || '')]
  if (!get) throw badRequest('provider 只能是 dingtalk / feishu')
  const { token, expiresAt } = await get()
  audit({ user: null, via: 'APP' }, 'app.channel_token', { entityType: 'app', entityId: app.id, detail: { code: app.code, provider } })
  return { provider, accessToken: token, expiresAt: expiresAt.toISOString() }
}

export async function notifyUsers(app, body) {
  if (!app.trusted) throw forbidden('只有管理员安装或登记的应用能给个人发消息')
  const { userIds, msg } = normalizeNotify(body)
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, deletedAt: null, active: true, spaceId: { in: spacesOfApp(app) } },
    select: { id: true, dingUserId: true, feishuOpenId: true, wecomUserId: true }
  })
  const found = new Set(users.map(u => u.id))
  const skipped = userIds.filter(id => !found.has(id)).map(userId => ({ userId, reason: '用户不存在、已停用或不在本应用的空间' }))
  const r = await sendToUsers(users, msg)
  return { sent: r.sent, skipped: [...skipped, ...r.skipped] }
}

/**
 * 按每个人绑定的账号发个人消息（钉钉工作通知 / 飞书卡片 / 企业微信应用消息）。平台内部也用（定时任务推结果）
 * users: [{ id, dingUserId, feishuOpenId, wecomUserId }]；msg: normalizeNotify 的 msg
 */
export async function sendToUsers(users, msg) {
  const skipped = []
  const can = { dingtalk: await dingtalk.canNotify(), feishu: await feishu.configured(), wecom: await wecom.configured() }

  const groups = { dingtalk: [], feishu: [], wecom: [] }
  for (const u of users) {
    const p = pickChannel(u, can)
    if (p.channel) groups[p.channel].push({ userId: u.id, id: p.id })
    else skipped.push({ userId: u.id, reason: p.reason })
  }
  const sent = []
  const fail = (list, e) => list.forEach(x => skipped.push({ userId: x.userId, reason: e.message }))
  if (groups.dingtalk.length) {
    try { await dingtalk.sendWorkNotice(groups.dingtalk.map(x => x.id), msg); sent.push(...groups.dingtalk.map(x => ({ userId: x.userId, channel: 'dingtalk' }))) } catch (e) { fail(groups.dingtalk, e) }
  }
  for (const x of groups.feishu) {
    try { await feishu.sendCard(x.id, msg); sent.push({ userId: x.userId, channel: 'feishu' }) } catch (e) { fail([x], e) }
  }
  if (groups.wecom.length) {
    try { await wecom.sendAppMessage(groups.wecom.map(x => x.id), msg); sent.push(...groups.wecom.map(x => ({ userId: x.userId, channel: 'wecom' }))) } catch (e) { fail(groups.wecom, e) }
  }
  return { sent, skipped }
}
