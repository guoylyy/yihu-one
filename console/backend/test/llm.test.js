// 应用大模型接口的纯逻辑单测（不依赖数据库）
// 全链路（真实模型调用、用量聚合、配额）见 scripts/selftest.sh 与本里程碑开发时的 mock 实测
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { estimateTokens, resolveUser, toModelList, normalizeEmbedInput, listUpstreamModels } = await import('../src/services/llm.js')
const { toAnthropicMessages } = await import('../src/agent/llm.js')
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

test('toModelList：OpenAI 形态、去重、首个为默认、不带密钥', () => {
  const r = toModelList([
    { id: 1, name: 'DeepSeek', model: 'deepseek-chat', apiKey: 'sk-x', baseUrl: 'https://x', isDefault: true },
    { id: 2, name: 'Qwen', model: 'qwen-max', description: '通义' },
    { id: 3, name: 'DeepSeek 备用', model: 'deepseek-chat' },
    { id: 4, name: 'broken', model: '' }
  ])
  assert.equal(r.object, 'list')
  assert.deepEqual(r.data.map(m => m.id), ['deepseek-chat', 'qwen-max'])
  assert.deepEqual(r.data.map(m => m.default), [true, false])
  assert.equal(r.data[1].description, '通义')
  assert.ok(!JSON.stringify(r).includes('sk-x'), '不带密钥')
  assert.ok(!JSON.stringify(r).includes('https://x'), '不带上游地址')
})

test('全局默认配额在设置 SCHEMA 里（不加环境变量）', () => {
  assert.ok(SCHEMA.llm, 'llm 设置组存在')
  assert.equal(SCHEMA.llm.page, 'ai')
  assert.equal(SCHEMA.llm.fields.dailyTokenLimit.type, 'number')
  assert.equal(SCHEMA.llm.fields.dailyTokenLimit.default, 0)
})

test('toAnthropicMessages：OpenAI 图片 part 转成 Anthropic image block', () => {
  const out = toAnthropicMessages([{
    role: 'user',
    content: [
      { type: 'text', text: '这是什么产品' },
      { type: 'image_url', image_url: { url: 'data:image/JPEG;base64,QUJD' } },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } }
    ]
  }])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].content, [
    { type: 'text', text: '这是什么产品' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
    { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }
  ])
})

test('toAnthropicMessages：纯文本消息不变，连续同角色合并', () => {
  const out = toAnthropicMessages([{ role: 'user', content: '你好' }, { role: 'user', content: [{ type: 'text', text: '再问' }] }])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].content, [{ type: 'text', text: '你好' }, { type: 'text', text: '再问' }])
})

test('normalizeEmbedInput：字符串转数组，空串 / 超长 / 太多条报 400', () => {
  assert.deepEqual(normalizeEmbedInput('竹制收纳盒'), ['竹制收纳盒'])
  assert.deepEqual(normalizeEmbedInput(['a', 'b']), ['a', 'b'])
  assert.throws(() => normalizeEmbedInput(''), e => e.status === 400)
  assert.throws(() => normalizeEmbedInput([]), e => e.status === 400)
  assert.throws(() => normalizeEmbedInput([1]), e => e.status === 400)
  assert.throws(() => normalizeEmbedInput('x'.repeat(8193)), e => e.status === 400)
  assert.throws(() => normalizeEmbedInput(Array(65).fill('a')), e => e.status === 400)
})

test('listUpstreamModels：读厂商 /models 去重，参数不全 / 对端报错时给出可读原因', async () => {
  const orig = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization })
    return new Response(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  }
  try {
    // 末尾斜杠要去掉，否则会拼成 //models
    const models = await listUpstreamModels({ baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-x' })
    assert.deepEqual(models, ['deepseek-flash', 'deepseek-v4-pro'])
    assert.equal(calls[0].url, 'https://api.deepseek.com/models')
    assert.equal(calls[0].auth, 'Bearer sk-x')
  } finally {
    globalThis.fetch = orig
  }

  await assert.rejects(() => listUpstreamModels({ provider: 'ANTHROPIC', apiKey: 'x' }), /只有 OpenAI 兼容/)
  await assert.rejects(() => listUpstreamModels({ baseUrl: 'https://api.deepseek.com' }), /先填 API Key/)

  globalThis.fetch = async () => new Response('{"error":"bad key"}', { status: 401 })
  try {
    await assert.rejects(() => listUpstreamModels({ baseUrl: 'https://api.deepseek.com', apiKey: 'k' }), /厂商接口返回 401/)
  } finally {
    globalThis.fetch = orig
  }
})
