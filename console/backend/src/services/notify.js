// 发布通知: 平台升级 / 应用自动发布的结果发到群机器人(飞书 / 钉钉 / 企业微信)
// 配置在「系统设置 → 发布通知」。发送方是宿主机上的 yh(经 /api/platform/notify-config 取配置),
// 平台升级中途控制台在重建也能照发; 控制台这边只负责配置、取数和「发测试消息」
import crypto from 'node:crypto'
import { get } from './settings.js'
import { assertAdmin } from '../lib/auth.js'
import { audit } from '../lib/audit.js'
import { badRequest } from '../lib/http.js'

const TIMEOUT = () => AbortSignal.timeout(10_000)

/** 各渠道生效配置(含密钥明文)。给平台接口(yh)和测试发送用 */
export async function channels() {
  const c = await get('notify')
  return {
    enabled: !!c.enabled,
    feishuWebhook: c.feishuWebhook || '',
    dingtalkWebhook: c.dingtalkWebhook || '',
    dingtalkSecret: c.dingtalkSecret || '',
    wecomWebhook: c.wecomWebhook || ''
  }
}

// ---- 三家的消息体(纯函数, 供测试) ----

/** 飞书自定义机器人: 文本消息。关键词安全模式下文本里要含关键词(「发布」) */
export const feishuBody = text => ({ msg_type: 'text', content: { text } })
/** 企业微信群机器人: 文本消息 */
export const wecomBody = text => ({ msgtype: 'text', text: { content: text } })
/** 钉钉自定义机器人: markdown 消息 */
export const dingtalkBody = (title, markdown) => ({ msgtype: 'markdown', markdown: { title, text: markdown } })

/** 钉钉「加签」: webhook 拼上 timestamp + sign(HMAC-SHA256) */
export function dingtalkSignedUrl(webhook, secret, now = Date.now()) {
  const ts = String(now)
  const sign = Buffer.from(crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest()).toString('base64')
  return `${webhook}${webhook.includes('?') ? '&' : '?'}timestamp=${ts}&sign=${encodeURIComponent(sign)}`
}

/** POST 一个 webhook, 返回 { ok, error? }。发送失败不抛, 让调用方决定怎么呈现 */
async function post(url, body) {
  let r
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), signal: TIMEOUT() })
  } catch (e) {
    return { ok: false, error: `连不上：${e.message}` }
  }
  const data = await r.json().catch(() => ({}))
  const code = data.errcode ?? data.code
  if (!r.ok || (code !== undefined && code !== 0)) return { ok: false, error: data.errmsg || data.msg || `HTTP ${r.status}` }
  return { ok: true }
}

/**
 * 按 channels 配置把一条消息发到所有已配渠道。
 * markdown 给钉钉; plain 给飞书 / 企业微信(文本消息, 不吃 markdown)
 * 返回 [{ channel, configured, ok, error }]
 */
export async function sendTo(c, { title, markdown, plain }) {
  const out = []
  if (c.feishuWebhook) {
    const r = await post(c.feishuWebhook, feishuBody(plain))
    out.push({ channel: 'feishu', configured: true, ...r })
  } else out.push({ channel: 'feishu', configured: false, ok: false, error: '未配置' })
  if (c.dingtalkWebhook) {
    const url = c.dingtalkSecret ? dingtalkSignedUrl(c.dingtalkWebhook, c.dingtalkSecret) : c.dingtalkWebhook
    const r = await post(url, dingtalkBody(title, markdown))
    out.push({ channel: 'dingtalk', configured: true, ...r })
  } else out.push({ channel: 'dingtalk', configured: false, ok: false, error: '未配置' })
  if (c.wecomWebhook) {
    const r = await post(c.wecomWebhook, wecomBody(plain))
    out.push({ channel: 'wecom', configured: true, ...r })
  } else out.push({ channel: 'wecom', configured: false, ok: false, error: '未配置' })
  return out
}

const NAMES = { feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信' }

/** 管理员点「发测试消息」: 按当前配置各发一条 */
export async function sendTest(ctx) {
  assertAdmin(ctx)
  const c = await channels()
  const title = '以虎 One 发布通知测试'
  const results = await sendTo(c, {
    title,
    markdown: `#### ${title}\n\n以后平台升级、应用自动发布的结果会发到这个群。\n\n> 以虎 One 自动发布`,
    plain: `${title}\n以后平台升级、应用自动发布的结果会发到这个群。\n\n以虎 One 自动发布`
  })
  audit(ctx, 'notify.test', { detail: { enabled: c.enabled, results: results.map(r => `${NAMES[r.channel]}:${r.ok ? 'ok' : r.error}`) } })
  const anyOk = results.some(r => r.ok)
  if (!anyOk) throw badRequest('没有一个渠道发成功：' + results.map(r => `${NAMES[r.channel]} ${r.error}`).join('；'))
  return { results: results.map(r => ({ ...r, name: NAMES[r.channel] })) }
}
