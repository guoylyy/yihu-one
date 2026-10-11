// 应用大模型接口的纯逻辑单测（不依赖数据库）
// 全链路（真实模型调用、用量聚合、配额）见 scripts/selftest.sh 与本里程碑开发时的 mock 实测
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { estimateTokens, resolveUser } = await import('../src/services/llm.js')
const { SCHEMA } = await import('../src/services/settings.js')

const fakeApp = { id: 7, code: 'cli_demo' }

test('estimateTokens：中文按字、英文按字符/4', () => {
  assert.equal(estimateTokens('你好世界'), 4)
  // 8 个 ASCII 字符 → 2
  assert.equal(estimateTokens('abcdefgh'), 2)
  // 5 个 ASCII 字符向上取整 → 2
  assert.equal(estimateTokens('hello'), 2)
  assert.equal(estimateTokens('你好abcdefgh'), 4)
  assert.equal(estimateTokens(''), 0)
})

test('resolveUser：不带 token 是匿名应用上下文', async () => {
  const r = await resolveUser(fakeApp, '', '127.0.0.1')
  assert.equal(r.user, null)
  assert.equal(r.ctx.via, 'APP')
  assert.equal(r.ctx.ip, '127.0.0.1')
})

test('resolveUser：非法 token 报 401', async () => {
  await assert.rejects(() => resolveUser(fakeApp, 'not-a-jwt', ''), e => e.status === 401)
})

test('resolveUser：签给别的应用的 token 报 401', async () => {
  const { signAppToken } = await import('../src/lib/auth.js')
  const token = signAppToken(1, 'cli_other')
  await assert.rejects(() => resolveUser(fakeApp, token, ''), e => e.status === 401)
})

test('全局默认配额在设置 SCHEMA 里（不加环境变量）', () => {
  assert.ok(SCHEMA.llm, 'llm 设置组存在')
  assert.equal(SCHEMA.llm.page, 'ai')
  assert.equal(SCHEMA.llm.fields.dailyTokenLimit.type, 'number')
  assert.equal(SCHEMA.llm.fields.dailyTokenLimit.default, 0)
})
