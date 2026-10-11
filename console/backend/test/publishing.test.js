// Agent 发布：失败原因要是人能看懂的话（yh 输出里的 ✗ 行），不是整段日志
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { summarizeLog } = await import('../src/services/publishing.js')
const { TOOLS } = await import('../src/tools/index.js')

test('失败原因：挑出 ✗ 行，去掉终端颜色', () => {
  const log = '\x1b[36m▶ 上线 采购（purchase）\x1b[0m\n  构建中…\n#12 ERROR: failed to solve\n\x1b[31m✗ 镜像构建失败：docker compose build purchase\x1b[0m\n'
  const s = summarizeLog(log)
  assert.match(s.reason, /✗ 镜像构建失败/)
  assert.ok(!s.reason.includes('\x1b'), '不带颜色码')
  assert.match(s.tail, /上线 采购/)
})

test('失败原因：没有错误行时 reason 为空，只给尾部', () => {
  const s = summarizeLog('a\nb\nc')
  assert.equal(s.reason, null)
  assert.equal(s.tail, 'a\nb\nc')
  assert.deepEqual(summarizeLog(null), { reason: null, tail: '' })
})

test('尾部最多 12 行', () => {
  const s = summarizeLog(Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n'))
  assert.equal(s.tail.split('\n').length, 12)
  assert.match(s.tail, /line29$/)
})

test('发布类工具：写操作都要确认，查询类不是写操作', () => {
  const by = Object.fromEntries(TOOLS.map(t => [t.name, t]))
  for (const n of ['publish_app', 'set_app_visibility', 'publish_skill']) {
    assert.equal(by[n].write, true, n)
    assert.equal(by[n].confirm, true, n)
    assert.equal(typeof by[n].summarize, 'function', `${n} 要有确认卡片上的一句话`)
  }
  for (const n of ['list_my_published', 'check_app_code', 'publish_status', 'list_skills', 'get_skill', 'check_skill_updates']) assert.ok(!by[n].write, n)
  assert.match(by.publish_app.summarize({ kind: 'LITE', name: '报名表', scope: 'SHARED' }), /新轻应用「报名表」.*分享/)
})
