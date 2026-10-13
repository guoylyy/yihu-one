import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeTools, resolveCall, searchTools, FIND, CALL, DIRECT_LIMIT } from '../src/agent/toolRouting.js'

const own = (n) => Array.from({ length: n }, (_, i) => ({ name: `own_${i}`, label: `平台工具${i}`, description: '平台' }))
const app = (code, name, n, extra = []) => [
  ...extra,
  ...Array.from({ length: n - extra.length }, (_, i) => ({ name: `${code}__t${i}`, label: `${name}：工具${i}`, description: `[应用：${name}] 第 ${i} 个`, appCode: code, appName: name, jsonSchema: { type: 'object', properties: {} } }))
]

test('工具不多：原样给模型，不加路由工具', () => {
  const tools = [...own(20), ...app('crm', '客户', 10)]
  const r = routeTools(tools)
  assert.equal(r.direct.length, 30)
  assert.equal(r.routed.length, 0)
  assert.ok(!r.direct.some(t => t.name === FIND))
})

test('工具多：平台工具和小应用直接给，大应用走路由，总数不超上限', () => {
  const tools = [...own(21), ...app('demo', '演示', 3), ...app('fde', 'FDE 交付管理', 111)]
  const r = routeTools(tools)
  assert.ok(r.direct.length <= DIRECT_LIMIT)
  assert.ok(r.direct.some(t => t.name === 'own_0'), '平台工具都在')
  assert.ok(r.direct.some(t => t.name === 'demo__t0'), '小应用直接给')
  assert.ok(!r.direct.some(t => t.name === 'fde__t0'), '大应用不直接列')
  assert.equal(r.routed.length, 111)
  assert.ok(r.direct.some(t => t.name === FIND) && r.direct.some(t => t.name === CALL))
  assert.match(r.direct.find(t => t.name === CALL).routedApps, /FDE 交付管理（fde）/)
})

test('find_app_tools：按关键词（含中文）找到工具，带参数', () => {
  const routed = app('fde', 'FDE 交付管理', 30, [
    { name: 'fde__submit_timesheet', label: 'FDE：提交工时', description: '[应用：FDE] 提交本周工时', appCode: 'fde', appName: 'FDE 交付管理', jsonSchema: { type: 'object', properties: { hours: { type: 'number' } } }, write: true },
    { name: 'fde__create_task', label: 'FDE：创建任务', description: '[应用：FDE] 在项目里创建任务', appCode: 'fde', appName: 'FDE 交付管理', write: true }
  ])
  const r = searchTools(routed, { query: '提交工时' })
  assert.equal(r.matches[0].name, 'fde__submit_timesheet')
  assert.deepEqual(r.matches[0].parameters.properties.hours, { type: 'number' })
  assert.equal(r.matches[0].write, true)
  assert.equal(r.matches[0].description, '提交本周工时', '去掉了「[应用：…]」前缀')
  assert.equal(searchTools(routed, { query: '任务', app: 'fde' }).matches[0].name, 'fde__create_task')
  const none = searchTools(routed, { query: '完全不相关的词xyz' })
  assert.equal(none.matches.length, 0)
  assert.ok(none.tools.length > 0, '没对上时给出工具清单')
})

test('call_app_tool：换成真实工具和参数；没查到的名字报错', () => {
  const routed = app('fde', 'FDE', 5)
  const ok = resolveCall(routed, { name: 'fde__t2', arguments: { a: 1 } })
  assert.equal(ok.tool.name, 'fde__t2')
  assert.deepEqual(ok.args, { a: 1 })
  assert.deepEqual(resolveCall(routed, { name: 'fde__t2' }).args, {})
  assert.match(resolveCall(routed, { name: 'own_1' }).error, /find_app_tools/, '不能借路由调平台工具或别的东西')
  assert.match(resolveCall(routed, {}).error, /未填写/)
})
