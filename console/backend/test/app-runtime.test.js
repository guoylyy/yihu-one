// yh agent 上报的应用运行状态：版本号、提交、发布时间
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { runtimeOf } = await import('../src/services/platform.js')

test('应用版本号和提交分开存', () => {
  const r = runtimeOf({ state: 'running', health: 'ok', version: '0.2.0', commit: '9d53075', commitAt: '2026-10-14T22:39:48-07:00', deployedAt: '2026-10-15T08:12:22Z', memory: '80MiB' }, 'now')
  assert.equal(r.version, '0.2.0')
  assert.equal(r.commit, '9d53075')
  assert.equal(r.deployedAt, '2026-10-15T08:12:22Z')
  assert.equal(r.at, 'now')
})

test('老版本 yh 把提交号放在 version 里：认成提交', () => {
  const r = runtimeOf({ state: 'running', version: '9d53075' }, 'now')
  assert.equal(r.version, null)
  assert.equal(r.commit, '9d53075')
})

test('没有版本、乱传的字段收敛成 null', () => {
  const r = runtimeOf({ state: 'running', version: '', commit: 123, deployedAt: {} }, 'now')
  assert.equal(r.version, null)
  assert.equal(r.commit, null)
  assert.equal(r.deployedAt, null)
})
