// 发布通知: 三家群机器人的消息体 / 加签 / 发送(假 fetch), 不发真请求
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const notify = await import('../src/services/notify.js')
let calls = []
function stub(routes) {
  calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k))
    if (!hit) throw new Error(`没有模拟 ${url}`)
    return { ok: true, status: 200, json: async () => (typeof hit[1] === 'function' ? hit[1](String(url), init) : hit[1]) }
  }
}
beforeEach(() => { calls = [] })

test('三家消息体格式', () => {
  assert.deepEqual(notify.feishuBody('你好'), { msg_type: 'text', content: { text: '你好' } })
  assert.deepEqual(notify.wecomBody('你好'), { msgtype: 'text', text: { content: '你好' } })
  assert.deepEqual(notify.dingtalkBody('标题', '正文'), { msgtype: 'markdown', markdown: { title: '标题', text: '正文' } })
})

test('钉钉加签: timestamp + HMAC-SHA256 base64', () => {
  const url = notify.dingtalkSignedUrl('https://oapi.dingtalk.com/robot/send?access_token=t', 'SEC123', 1700000000000)
  const [base, q] = url.split('?')
  assert.equal(base, 'https://oapi.dingtalk.com/robot/send')
  const params = Object.fromEntries(new URLSearchParams(q))
  assert.equal(params.timestamp, '1700000000000')
  // sign = base64(hmac_sha256("1700000000000\nSEC123", key=SEC123)) 再 urlencode
  const want = Buffer.from(crypto.createHmac('sha256', 'SEC123').update('1700000000000\nSEC123').digest()).toString('base64')
  // URLSearchParams.get 会把 %3D 解码回 =, 所以拿到的就是原始 base64
  assert.equal(params.sign, want)
  // webhook 本来没有问号时用 ? 拼
  assert.equal(notify.dingtalkSignedUrl('https://x/y', 'SEC123', 1).split('?')[0], 'https://x/y')
})

test('sendTo: 已配的渠道各发一条, 没配的标未配置; 失败不抛', async () => {
  stub({
    '/feishu/': (url, init) => {
      const b = JSON.parse(init.body)
      assert.deepEqual(Object.keys(b), ['msg_type', 'content'])
      assert.match(b.content.text, /发布/) // 关键词安全模式要含「发布」
      return { code: 0 }
    },
    '/dingtalk/': { errcode: 0 },
    '/wecom/': (url, init) => {
      const b = JSON.parse(init.body)
      assert.equal(b.msgtype, 'text')
      return { errcode: 300001, errmsg: '不是有效的webhook' } // 假装企业微信配错了
    }
  })
  const r = await notify.sendTo(
    { feishuWebhook: 'https://a/feishu/x', dingtalkWebhook: 'https://a/dingtalk/y', wecomWebhook: 'https://a/wecom/z' },
    { title: 'T', markdown: '#### T\n正文', plain: 'T\n正文\n\n以虎 One 自动发布' }
  )
  assert.equal(r.length, 3)
  assert.deepEqual([r[0].ok, r[1].ok, r[2].ok], [true, true, false])
  assert.match(r[2].error, /不是有效的webhook/)
  // 加签密钥配上后 URL 带 timestamp/sign
  await notify.sendTo({ dingtalkWebhook: 'https://a/dingtalk/y', dingtalkSecret: 'SECx' }, { title: 'T', markdown: 'm', plain: 'p' })
  assert.match(calls.at(-1).url, /timestamp=\d+&sign=/)
})

test('sendTo: 接口报业务错误码也算失败', async () => {
  stub({ '/feishu/': { code: 19021, msg: 'sign match fail' } })
  const r = await notify.sendTo({ feishuWebhook: 'https://a/feishu/x' }, { title: 'T', markdown: 'm', plain: 'p' })
  assert.equal(r[0].ok, false)
  assert.match(r[0].error, /sign match fail/)
})
