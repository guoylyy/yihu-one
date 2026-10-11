// 空间（多公司 / 客户隔离）：可见性统一走 visibleTo 的「空间 → 组织 → 人」，查人查部门按空间收敛
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { visibleTo } = await import('../src/services/apps.js')
const { spacesOfApp, appInSpace, spaceWhere } = await import('../src/services/spaces.js')
const { canSee } = await import('../src/services/kb.js')

const yihu = { id: 7, roles: ['MEMBER'], deptIds: [3], spaceId: 1 }
const sister = { id: 8, roles: ['MEMBER'], deptIds: [40], spaceId: 2 }
const admin = { id: 1, roles: ['ADMIN'], deptIds: [], spaceId: 1 }
const market = (extra = {}) => ({ publisherId: 99, scope: 'MARKET', listed: true, visibility: null, spaceId: 1, ...extra })

test('老数据没有 spaceId：都算默认空间，行为和以前一样', () => {
  const legacyUser = { id: 7, roles: ['MEMBER'], deptIds: [3] }
  assert.equal(visibleTo({ publisherId: 99, scope: 'MARKET', listed: true, visibility: null }, legacyUser), true)
  assert.deepEqual(spacesOfApp({}), [1])
})

test('别的空间的应用看不到，哪怕上架全员', () => {
  assert.equal(visibleTo(market(), yihu), true)
  assert.equal(visibleTo(market(), sister), false, '兄弟公司的人看不到以虎空间的应用')
})

test('一个应用可以分享给多个空间；分享后进去的空间照样按可见范围再收敛', () => {
  const app = market({ extraSpaceIds: [2] })
  assert.deepEqual(spacesOfApp(app), [1, 2])
  assert.equal(visibleTo(app, sister), true)
  assert.equal(visibleTo({ ...app, visibility: { deptIds: [3] } }, sister), false, '空间进来了，但部门不在范围里')
  assert.equal(visibleTo({ ...app, visibility: { deptIds: [40] } }, sister), true)
})

test('发布者自己的应用：在自己空间里照常可见；被挪到别的空间就看不到了', () => {
  const mine = { publisherId: 8, scope: 'PRIVATE', listed: false, visibility: null, spaceId: 2 }
  assert.equal(visibleTo(mine, sister), true)
  assert.equal(visibleTo({ ...mine, spaceId: 1 }, sister), false)
})

test('管理员跨空间', () => {
  assert.equal(appInSpace(market({ spaceId: 2 }), admin), true)
  assert.equal(visibleTo(market({ spaceId: 2 }), admin), true)
})

test('查人 / 部门：普通人只能看自己空间（传了别的空间也不行），管理员可以指定，不指定看全部', () => {
  assert.deepEqual(spaceWhere(yihu), { spaceId: 1 })
  assert.deepEqual(spaceWhere(sister, 1), { spaceId: 2 }, '普通人带 spaceId=1 也只能看自己空间')
  assert.deepEqual(spaceWhere(admin, 2), { spaceId: 2 })
  assert.deepEqual(spaceWhere(admin), {})
})

test('知识库按空间收敛', () => {
  const kb = { scope: 'ALL', spaceId: 1 }
  assert.equal(canSee(yihu, kb), true)
  assert.equal(canSee(sister, kb), false)
  assert.equal(canSee(admin, { ...kb, spaceId: 2 }), true)
  assert.equal(canSee({ id: 7, roles: ['MEMBER'], deptIds: [] }, { scope: 'ALL' }), true, '老数据默认空间')
})
