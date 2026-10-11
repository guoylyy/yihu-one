// 千人千面首页：Agent 交上来的布局是不可信的结构化 JSON，平台校验后才渲染
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { normalizeCards, TEMPLATE, TYPES } = await import('../src/services/home.js')
const RO = new Set(['list_my_apps', 'fde__pending_approvals'])

test('默认首页 = 原来的工作台（问候、开始配置、AI 助手、我的应用）', () => {
  assert.deepEqual(TEMPLATE.map(c => c.type), ['greeting', 'setup', 'assistant', 'apps'])
  assert.deepEqual(normalizeCards(TEMPLATE, RO), TEMPLATE, '模板本身能通过校验')
})

test('类型白名单：不认识的类型（比如 html）直接拒绝', () => {
  assert.throws(() => normalizeCards([{ type: 'html', html: '<script>alert(1)</script>' }]), /不支持/)
  assert.ok(!TYPES.includes('html'))
})

test('文字卡片：只留 title / text，多余字段丢掉', () => {
  const [c] = normalizeCards([{ type: 'text', title: '提醒', text: '周五交周报', html: '<b>x</b>', onclick: 'x()' }])
  assert.deepEqual(Object.keys(c).sort(), ['id', 'text', 'title', 'type'])
})

test('链接只认 http / https', () => {
  assert.throws(() => normalizeCards([{ type: 'link', title: 'x', url: 'javascript:alert(1)' }]), /http/)
  assert.throws(() => normalizeCards([{ type: 'link', title: 'x', url: 'data:text/html,hi' }]), /http/)
  assert.equal(normalizeCards([{ type: 'link', title: '官网', url: 'https://example.com' }])[0].url, 'https://example.com')
})

test('数据卡片：只能用只读工具；折线图要 x / y；view 不认识就用 auto', () => {
  assert.throws(() => normalizeCards([{ type: 'data', tool: 'set_my_home' }], RO), /只读工具/, '写操作工具不在只读集合里')
  assert.throws(() => normalizeCards([{ type: 'data', tool: 'nope' }], RO), /只读工具/)
  assert.throws(() => normalizeCards([{ type: 'data', tool: 'fde__pending_approvals', view: 'line' }], RO), /x 和 y/)
  const [c] = normalizeCards([{ type: 'data', title: '待审批', tool: 'fde__pending_approvals', args: { limit: 10 }, view: 'weird' }], RO)
  assert.equal(c.view, 'auto')
  assert.deepEqual(c.args, { limit: 10 })
  assert.throws(() => normalizeCards([{ type: 'data', tool: 'list_my_apps', args: { q: 'x'.repeat(3000) } }], RO), /参数太长/)
})

test('id：缺了或重复就重新生成，保证唯一', () => {
  const cs = normalizeCards([{ id: 'a', type: 'apps' }, { id: 'a', type: 'assistant' }, { type: 'greeting' }, { id: 'bad id!', type: 'setup' }])
  assert.equal(new Set(cs.map(c => c.id)).size, 4)
  assert.equal(cs[0].id, 'a')
})

test('数量上限、应用入口要有 appId、width 只认 half', () => {
  assert.throws(() => normalizeCards(Array.from({ length: 31 }, () => ({ type: 'greeting' }))), /最多 30/)
  assert.throws(() => normalizeCards([{ type: 'app' }]), /appId/)
  const [c] = normalizeCards([{ type: 'app', appId: 3, width: 'wide' }])
  assert.equal(c.width, undefined)
  assert.equal(normalizeCards([{ type: 'apps', width: 'half', hidden: 1 }])[0].hidden, true)
  assert.throws(() => normalizeCards('not array'), /数组/)
})
