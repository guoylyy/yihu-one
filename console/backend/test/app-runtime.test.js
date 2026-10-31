// yh agent 上报的应用运行状态：版本号、提交、发布时间
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { runtimeOf, mountsOf } = await import('../src/services/platform.js')

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

test('宿主目录挂载：只留认识的字段', () => {
  const [m] = mountsOf([{ name: 'library', container: '/data/library', mode: 'ro', required: true, description: '知识库', envKey: 'YH_MOUNT_LIBRARY', hostPath: '/Users/a/笔记 空间', configured: true, problem: null, extra: 'x' }])
  assert.deepEqual(m, { name: 'library', container: '/data/library', mode: 'ro', required: true, description: '知识库', envKey: 'YH_MOUNT_LIBRARY', hostPath: '/Users/a/笔记 空间', configured: true, problem: null })
})

test('宿主目录挂载：模式写错按只读，configured 必须明确是 true，缺名称的丢掉', () => {
  const list = mountsOf([{ name: 'a', container: '/a', mode: 'RW', configured: 'true', required: 1 }, { container: '/b' }, null, 'x'])
  assert.equal(list.length, 1)
  assert.equal(list[0].mode, 'ro')
  assert.equal(list[0].configured, false)
  assert.equal(list[0].required, false)
})

test('宿主目录挂载：不是数组时不动这一列（老版本 yh、清单写错），空数组是清空', () => {
  assert.equal(mountsOf(undefined), undefined)
  assert.equal(mountsOf(null), undefined)
  assert.deepEqual(mountsOf([]), [])
})
