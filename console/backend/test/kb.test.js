// 知识库: 切分 / 可见范围 / 余弦 / 查询短词(纯函数, 不需要数据库)
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const kb = await import('../src/services/kb.js')
const kbdoc = await import('../src/services/kbdoc.js')

const userWith = (deptIds, roles = ['MEMBER']) => ({ deptIds, roles, name: 'u' })

test('canSee: 范围判定', () => {
  const all = { scope: 'ALL' }, admin = { scope: 'ADMIN' }, dept = { scope: 'DEPT', deptIds: [3, 4] }
  assert.equal(kb.canSee(userWith([1]), all), true)
  assert.equal(kb.canSee(userWith([1]), admin), false)
  assert.equal(kb.canSee(userWith([1], ['ADMIN']), admin), true) // 管理员全见
  assert.equal(kb.canSee(userWith([4]), dept), true)
  assert.equal(kb.canSee(userWith([9]), dept), false)
  // 管理员即使 scope 不匹配也能看
  assert.equal(kb.canSee(userWith([9], ['ADMIN']), dept), true)
})

test('cosine: 同向=1, 正交=0, 等长校验', () => {
  assert.equal(kb.cosine([1, 0], [1, 0]), 1)
  assert.equal(kb.cosine([1, 0], [0, 1]), 0)
  assert.ok(kb.cosine([1, 1], [1, 0]) > 0.7)
  assert.equal(kb.cosine([1], [1, 2]), 0)
  assert.equal(kb.cosine([], []), 0)
})

test('queryTerms: 中文 2-gram + 英文小写词', () => {
  const t = kb.queryTerms('差旅费 报销 DeepSeek')
  assert.ok(t.includes('差旅'))
  assert.ok(t.includes('旅费'))
  assert.ok(t.includes('报销'))
  assert.ok(t.includes('deepseek'))
  assert.deepEqual(kb.queryTerms(''), [])
})

test('chunkText: 空文本空数组; 控制目标长度', () => {
  assert.deepEqual(kbdoc.chunkText('   '), [])
  const chunks = kbdoc.chunkText('字'.repeat(1200))
  assert.ok(chunks.length >= 2)
  // 除尾片外, 每片应在目标长度附近(允许重叠)
  assert.ok(chunks[0].length >= 450)
})

test('chunkText: 重叠 — 相邻片开头带上片结尾', () => {
  const sent = '测试用的中文句子带标点符号。'
  const chunks = kbdoc.chunkText(Array(60).fill(sent).join(''))
  assert.ok(chunks.length >= 2)
  assert.equal(chunks[1].startsWith(chunks[0].slice(-80)), true)
})
