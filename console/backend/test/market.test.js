// 应用市场的纯逻辑：发布范围与可见性、内容校验、轻应用代码处理
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { visibleTo, openUrlOf } = await import('../src/services/apps.js')
const { normalizePayload, normalizePermissions } = await import('../src/services/studio.js')
const { extractHtml, sanitizeHtml, inferPermissions } = await import('../src/services/codegen.js')

const me = { id: 7, roles: ['MEMBER'], deptIds: [3] }
const other = { id: 8, roles: ['MEMBER'], deptIds: [4] }
const admin = { id: 1, roles: ['ADMIN'], deptIds: [] }

test('发布范围：仅自己', () => {
  const app = { publisherId: 7, scope: 'PRIVATE', listed: false, visibility: null }
  assert.equal(visibleTo(app, me), true)
  assert.equal(visibleTo(app, other), false)
  assert.equal(visibleTo(app, admin), false, '管理员也看不到别人的私有应用（在审核台里管）')
})

test('发布范围：分享给指定人 / 部门', () => {
  const app = { publisherId: 7, scope: 'SHARED', listed: false, visibility: { userIds: [8] } }
  assert.equal(visibleTo(app, other), true)
  assert.equal(visibleTo(app, admin), false)
  assert.equal(visibleTo({ ...app, visibility: { deptIds: [4] } }, other), true)
  assert.equal(visibleTo({ ...app, visibility: null }, other), false, '分享但没选人 = 谁都看不到')
})

test('发布范围：上架市场要审核通过（listed）', () => {
  const app = { publisherId: 7, scope: 'MARKET', listed: false, visibility: null }
  assert.equal(visibleTo(app, other), false, '还没审核通过')
  assert.equal(visibleTo({ ...app, listed: true }, other), true)
  assert.equal(visibleTo({ ...app, listed: true, visibility: { deptIds: [3] } }, other), false)
  assert.equal(visibleTo({ ...app, listed: true, visibility: { deptIds: [3] } }, admin), true, '管理员总能看到上架的')
})

test('AI 助手 / 轻应用在控制台里打开', () => {
  assert.equal(openUrlOf({ kind: 'AGENT', id: 5 }), '/assistant?app=5')
  assert.equal(openUrlOf({ kind: 'LITE', id: 6 }), '/lite/6')
  assert.equal(openUrlOf({ kind: 'HOSTED', url: 'http://x/apps/a/' }), 'http://x/apps/a/')
})

test('内容校验', () => {
  assert.throws(() => normalizePayload('AGENT', { prompt: '' }, true), /提示词/)
  const a = normalizePayload('AGENT', { prompt: ' 你好 ', tools: ['a', 'a', 'b'], starters: ['q1', '', 'q2'] })
  assert.deepEqual(a.tools, ['a', 'b'])
  assert.deepEqual(a.starters, ['q1', 'q2'])
  assert.equal(a.prompt, '你好')
  assert.throws(() => normalizePayload('LITE', { html: '' }, true), /还没有页面/)
  assert.throws(() => normalizePayload('LITE', { html: 'x'.repeat(400_001) }), /太大/)
  assert.throws(() => normalizePayload('EXTERNAL', { url: 'ftp://x' }, true), /地址/)
  assert.throws(() => normalizePayload('EXTERNAL', { url: 'https://x', redirectUris: ['javascript:1'] }, true), /回调/)
  assert.throws(() => normalizePayload('HOSTED', { git: '/etc/passwd' }, true), /仓库/)
  assert.doesNotThrow(() => normalizePayload('HOSTED', { git: 'git@gitee.com:a/b.git' }, true))
})

test('权限声明只认已知字段', () => {
  assert.deepEqual(normalizePermissions('EXTERNAL', { scopes: ['org', 'contact', 'root'] }), { scopes: ['org', 'contact'] })
  assert.deepEqual(normalizePermissions('LITE', { ai: 1, tools: ['x', 'x'] }), { ai: true, tools: ['x'] })
  assert.equal(normalizePermissions('AGENT', {}), null)
})

test('从模型输出里取 HTML、去掉自动跳转', () => {
  const html = extractHtml('做好了。\n```html\n<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=https://evil"></head><body>hi</body></html>\n```')
  assert.ok(html.startsWith('<!DOCTYPE html>'))
  assert.ok(!/refresh/i.test(html))
  assert.ok(extractHtml('没有代码块 <!doctype html><html><body>x</body></html> 结束').includes('<body>x</body>'))
  assert.equal(extractHtml('只有文字'), null)
  assert.ok(!/refresh/i.test(sanitizeHtml("<META HTTP-EQUIV='Refresh' CONTENT='1'>")))
})

test('按代码推断轻应用要申请的权限', () => {
  const known = new Set(['get_my_profile'])
  assert.deepEqual(inferPermissions('await yh.ai.ask("x"); yh.tools.call("get_my_profile"); yh.tools.call("rm_rf")', known), { ai: true, tools: ['get_my_profile'] })
  assert.deepEqual(inferPermissions('yh.db.list("a")', known), { ai: false, tools: [] })
})
