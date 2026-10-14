// 开放接口: 应用信息(品牌合并) + 给个人发消息(参数校验、选渠道、三家消息体) 的纯逻辑单测(不依赖数据库)
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { absoluteUrl, mergeBrand, pickChannel, normalizeNotify } = await import('../src/services/openApp.js')
const { workNoticeMsg } = await import('../src/lib/dingtalk.js')
const { messageCard } = await import('../src/lib/feishu.js')
const { appMessage } = await import('../src/lib/wecom.js')

const platform = { workspaceName: '以虎 One', logo: '', theme: { preset: 'yihu', logo: '/brand/yihu/logo-mark.svg', tokens: { primary: '#1c1917', highlight: '#d2521e' } } }

test('absoluteUrl：站内路径补平台地址，外部地址和 data URL 原样', () => {
  assert.equal(absoluteUrl('/brand/x.svg', 'https://one.example.com/'), 'https://one.example.com/brand/x.svg')
  assert.equal(absoluteUrl('https://cdn.example.com/a.png', 'https://one.example.com'), 'https://cdn.example.com/a.png')
  assert.equal(absoluteUrl('data:image/png;base64,AA==', 'https://one'), 'data:image/png;base64,AA==')
  assert.equal(absoluteUrl('//evil.example.com/x.png', 'https://one'), '//evil.example.com/x.png')
  assert.equal(absoluteUrl('', 'https://one'), '')
})

test('mergeBrand：没有空间 VI 用平台的，预设 LOGO 补成完整地址', () => {
  const b = mergeBrand(platform, null, 'https://one.example.com')
  assert.equal(b.name, '以虎 One')
  assert.equal(b.logo, 'https://one.example.com/brand/yihu/logo-mark.svg')
  assert.equal(b.theme.tokens.highlight, '#d2521e')
})

test('mergeBrand：空间有自己的名称 / LOGO / 主题时优先', () => {
  const space = { name: 'Acme', logo: 'https://acme.example.com/logo.png', theme: { preset: 'classic', tokens: { primary: '#2563eb', highlight: '#2563eb' } } }
  const b = mergeBrand(platform, space, 'https://one.example.com')
  assert.deepEqual([b.name, b.logo, b.theme.preset], ['Acme', 'https://acme.example.com/logo.png', 'classic'])
})

test('pickChannel：按钉钉 → 飞书 → 企业微信，只选平台能发且本人绑定了的', () => {
  const u = { dingUserId: 'd1', feishuOpenId: 'ou_1', wecomUserId: 'w1' }
  assert.deepEqual(pickChannel(u, { dingtalk: true, feishu: true, wecom: true }), { channel: 'dingtalk', id: 'd1' })
  assert.deepEqual(pickChannel(u, { dingtalk: false, feishu: true, wecom: true }), { channel: 'feishu', id: 'ou_1' })
  assert.deepEqual(pickChannel({ wecomUserId: 'w1' }, { dingtalk: true, feishu: true, wecom: true }), { channel: 'wecom', id: 'w1' })
  assert.equal(pickChannel({ dingUserId: 'd1' }, { dingtalk: false, feishu: true, wecom: true }).channel, null)
})

test('normalizeNotify：去重、限量、必填、链接只收 http(s)', () => {
  const r = normalizeNotify({ userIds: [3, '3', 5, 'x', -1], title: ' 新任务 ', content: '**修复登录** 指派给你', url: 'https://one.example.com/apps/fde/admin/tasks/9' })
  assert.deepEqual(r.userIds, [3, 5])
  assert.equal(r.msg.title, '新任务')
  assert.equal(r.msg.plain, '修复登录 指派给你')
  assert.throws(() => normalizeNotify({ userIds: [], title: 'a', content: 'b' }), /userIds/)
  assert.throws(() => normalizeNotify({ userIds: Array.from({ length: 101 }, (_, i) => i + 1), title: 'a', content: 'b' }), /100/)
  assert.throws(() => normalizeNotify({ userIds: [1], title: '', content: 'b' }), /title/)
  assert.throws(() => normalizeNotify({ userIds: [1], title: 'a', content: 'b', url: 'javascript:alert(1)' }), /http/)
})

test('三家消息体：有链接带按钮 / 卡片，没链接是 markdown', () => {
  const withUrl = { title: '新任务', markdown: '修复登录', plain: '修复登录', url: 'https://x/t/1' }
  const noUrl = { ...withUrl, url: null }
  assert.equal(workNoticeMsg(withUrl).action_card.single_url, 'https://x/t/1')
  assert.equal(workNoticeMsg(noUrl).msgtype, 'markdown')
  assert.equal(messageCard(withUrl).elements[1].actions[0].url, 'https://x/t/1')
  assert.equal(messageCard(noUrl).elements.length, 1)
  const w = appMessage('1000002', ['a', 'b'], withUrl)
  assert.deepEqual([w.touser, w.agentid, w.msgtype, w.textcard.url], ['a|b', 1000002, 'textcard', 'https://x/t/1'])
  assert.equal(appMessage('1', ['a'], noUrl).msgtype, 'markdown')
})
