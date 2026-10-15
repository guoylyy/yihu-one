import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanMetrics, cleanEvents, cleanDecisions, standardToolsByApp } from '../src/services/overview.js'

test('指标：规整字段、丢掉没名字的、最多 8 个、链接只认 http(s)', () => {
  const r = cleanMetrics({ metrics: [
    { name: '进行中项目', value: 12, unit: '个', change: 2, trend: 'up', good: true, url: 'https://a.example.com/p' },
    { name: '本月工时', value: '1,280', trend: 'sideways', url: 'javascript:alert(1)' },
    { value: 3 },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `m${i}`, value: i }))
  ] })
  assert.equal(r.length, 8)
  assert.deepEqual(r[0], { name: '进行中项目', value: 12, unit: '个', change: 2, trend: 'up', good: true, note: null, url: 'https://a.example.com/p' })
  assert.equal(r[1].trend, null, '不认识的趋势丢掉')
  assert.equal(r[1].url, null, '不是 http(s) 的链接丢掉')
  assert.deepEqual(cleanMetrics(null), [])
  assert.deepEqual(cleanMetrics('乱七八糟'), [])
})

test('动态：风险在前，级别不认识按 info，最多 20 条', () => {
  const r = cleanEvents({ items: [
    { title: '里程碑完成', level: 'info' },
    { title: '项目 A 延期', level: 'risk', detail: 'x'.repeat(500) },
    { title: '预算接近上限', level: 'warn' },
    { title: '怪级别', level: 'boom' }
  ] })
  assert.deepEqual(r.map(e => e.level), ['risk', 'warn', 'info', 'info'])
  assert.equal(r[0].detail.length, 300, '截断')
  assert.equal(cleanEvents({ items: Array.from({ length: 30 }, (_, i) => ({ title: `e${i}` })) }).length, 20)
})

test('待决策：只留有标题的，字段截断', () => {
  const r = cleanDecisions({ items: [{ id: 7, title: '张三的工时待审批', requester: '张三', deadline: '2026-10-20', url: 'https://x.example.com/t/7' }, { detail: '没标题' }] })
  assert.equal(r.length, 1)
  assert.deepEqual(r[0], { id: '7', title: '张三的工时待审批', detail: null, requester: '张三', deadline: '2026-10-20', url: 'https://x.example.com/t/7' })
})

test('按应用找标准工具：按原工具名认，平台工具和别的工具不算', () => {
  const tools = [
    { name: 'get_my_profile' },
    { name: 'fde__get_key_metrics', toolName: 'get_key_metrics', appCode: 'fde', appName: 'FDE' },
    { name: 'fde__list_pending_decisions', toolName: 'list_pending_decisions', appCode: 'fde', appName: 'FDE' },
    { name: 'fde__list_projects', toolName: 'list_projects', appCode: 'fde', appName: 'FDE' },
    { name: 'crm__get_daily_summary', toolName: 'get_daily_summary', appCode: 'crm', appName: 'CRM' },
    { name: 'x__metrics', toolName: 'get_key_metrics_v2', appCode: 'x', appName: 'X' }
  ]
  const r = standardToolsByApp(tools)
  assert.deepEqual(r.map(a => [a.code, Object.keys(a.tools).sort()]), [['fde', ['decisions', 'metrics']], ['crm', ['events']]])
})
