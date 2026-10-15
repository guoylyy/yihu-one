import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRunAt, normalizeSchedule, describeSchedule, zonedToUtc, partsIn, validTz, pushText } from '../src/services/schedule.js'

const SH = 'Asia/Shanghai'
const at = (iso) => new Date(iso)

test('时区换算：上海 08:00 = UTC 00:00；纽约夏令时也对', () => {
  assert.equal(zonedToUtc(2026, 10, 14, 8, 0, SH).toISOString(), '2026-10-14T00:00:00.000Z')
  assert.equal(zonedToUtc(2026, 7, 1, 9, 30, 'America/New_York').toISOString(), '2026-07-01T13:30:00.000Z')
  assert.equal(zonedToUtc(2026, 12, 1, 9, 30, 'America/New_York').toISOString(), '2026-12-01T14:30:00.000Z')
  assert.equal(partsIn(at('2026-10-14T00:00:00Z'), SH).wd, 3, '2026-10-14 是周三')
  assert.equal(validTz('Not/AZone'), 'Asia/Shanghai')
})

test('每天：今天的时间没过就是今天，过了就是明天', () => {
  const s = { kind: 'daily', time: '08:00' }
  assert.equal(nextRunAt(s, SH, at('2026-10-13T23:00:00Z')).toISOString(), '2026-10-14T00:00:00.000Z') // 上海 07:00
  assert.equal(nextRunAt(s, SH, at('2026-10-14T00:00:00Z')).toISOString(), '2026-10-15T00:00:00.000Z', '正好到点算已过（严格晚于）')
})

test('工作日：周五晚上之后是下周一', () => {
  const s = { kind: 'weekdays', time: '08:00' }
  assert.equal(nextRunAt(s, SH, at('2026-10-16T12:00:00Z')).toISOString(), '2026-10-19T00:00:00.000Z') // 周五 20:00 → 周一 08:00
})

test('每周：周五 17:00', () => {
  const s = { kind: 'weekly', time: '17:00', weekday: 5 }
  assert.equal(nextRunAt(s, SH, at('2026-10-14T00:00:00Z')).toISOString(), '2026-10-16T09:00:00.000Z')
  assert.equal(nextRunAt(s, SH, at('2026-10-16T10:00:00Z')).toISOString(), '2026-10-23T09:00:00.000Z', '这周的过了就是下周')
})

test('校验与描述', () => {
  assert.deepEqual(normalizeSchedule({ kind: 'weekly', time: '17:00', weekday: '5' }), { kind: 'weekly', time: '17:00', weekday: 5 })
  assert.throws(() => normalizeSchedule({ kind: 'hourly', time: '08:00' }), /频率/)
  assert.throws(() => normalizeSchedule({ kind: 'daily', time: '8:00' }), /HH:mm/)
  assert.throws(() => normalizeSchedule({ kind: 'weekly', time: '08:00' }), /星期几/)
  assert.equal(describeSchedule({ kind: 'weekdays', time: '08:00' }), '工作日 08:00')
  assert.equal(describeSchedule({ kind: 'weekly', time: '17:00', weekday: 5 }), '每周五 17:00')
})

test('推送正文：一屏以内，超出截断并附全文链接', () => {
  const long = Array.from({ length: 200 }, (_, i) => `第 ${i} 行，内容内容内容`).join('\n')
  const t = pushText(long, 'https://one.example.com/assistant?c=1')
  assert.ok(t.length < 1900)
  assert.match(t, /…\n\n\[查看全文、接着问\]\(https:\/\/one\.example\.com\/assistant\?c=1\)$/)
  assert.equal(pushText('短的', null), '短的')
})
