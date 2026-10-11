// 不依赖数据库的单元测试：密码、可见范围、应用 code、设置定义、工具注册表
// 端到端（建库、登录、插拔应用、自动发布）见仓库根目录 scripts/selftest.sh
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { hashPassword, verifyPassword, checkPasswordStrength, signAppToken, verifyToken } = await import('../src/lib/auth.js')
const { visibleTo } = await import('../src/services/apps.js')
const { checkCode } = await import('../src/services/platform.js')
const { SCHEMA } = await import('../src/services/settings.js')
const { TOOLS, toOpenAiTools } = await import('../src/tools/index.js')
const { encryptJson, decryptJson } = await import('../src/lib/secret.js')

test('密码哈希与校验', () => {
  const h = hashPassword('abc12345')
  assert.ok(h.startsWith('scrypt$'))
  assert.notEqual(hashPassword('abc12345'), h, '每次加盐不同')
  assert.equal(verifyPassword('abc12345', h), true)
  assert.equal(verifyPassword('abc12346', h), false)
  assert.equal(verifyPassword('abc12345', null), false)
})

test('密码强度', () => {
  assert.throws(() => checkPasswordStrength('a1'), /至少 8 位/)
  assert.throws(() => checkPasswordStrength('abcdefgh'), /字母和数字/)
  assert.throws(() => checkPasswordStrength('12345678'), /字母和数字/)
  assert.doesNotThrow(() => checkPasswordStrength('abcd1234'))
})

test('应用可见范围', () => {
  // 管理员登记 / 安装的应用：上架在市场里（scope MARKET、listed）
  const M = (visibility) => ({ scope: 'MARKET', listed: true, visibility })
  const member = { id: 7, roles: ['MEMBER'], deptIds: [3] }
  const admin = { id: 1, roles: ['ADMIN'], deptIds: [] }
  assert.equal(visibleTo(M(null), member), true)
  assert.equal(visibleTo(M({ deptIds: [], userIds: [], roles: [] }), member), true)
  assert.equal(visibleTo(M({ deptIds: [3] }), member), true)
  assert.equal(visibleTo(M({ deptIds: ['3'] }), member), true)
  assert.equal(visibleTo(M({ deptIds: [4] }), member), false)
  assert.equal(visibleTo(M({ userIds: [7] }), member), true)
  assert.equal(visibleTo(M({ roles: ['MEMBER'] }), member), true)
  assert.equal(visibleTo(M({ deptIds: [4] }), admin), true, '管理员总是可见')
})

test('应用 code 规则', () => {
  assert.doesNotThrow(() => checkCode('kaoqin'))
  assert.doesNotThrow(() => checkCode('demo-node2'))
  assert.throws(() => checkCode('Kaoqin'))
  assert.throws(() => checkCode('1abc'))
  assert.throws(() => checkCode('a'))
  assert.throws(() => checkCode('api'), /保留/)
  assert.throws(() => checkCode('console'), /保留/)
})

test('应用 access_token 与登录 token 不能混用', () => {
  const t = signAppToken(5, 'demo')
  const p = verifyToken(t)
  assert.equal(p.type, 'app')
  assert.equal(p.sub, 5)
  assert.equal(p.aud, 'demo')
})

test('敏感配置加解密', () => {
  const enc = encryptJson({ k: 'sk-xxx' })
  assert.ok(enc.startsWith('v1.'))
  assert.deepEqual(decryptJson(enc), { k: 'sk-xxx' })
})

test('设置定义完整', () => {
  for (const [key, g] of Object.entries(SCHEMA)) {
    assert.ok(g.label && g.page, `${key} 缺 label / page`)
    for (const [k, f] of Object.entries(g.fields)) {
      assert.ok(f.label && f.type, `${key}.${k} 缺 label / type`)
      assert.ok('default' in f, `${key}.${k} 缺 default`)
    }
  }
  assert.equal(SCHEMA.login.fields.password.default, true, '默认必须能用密码登录，否则首次部署进不去')
})

test('工具注册表能转成 function calling 格式', () => {
  const names = TOOLS.map(t => t.name)
  assert.equal(new Set(names).size, names.length, '工具名不能重复')
  for (const t of toOpenAiTools()) {
    assert.equal(t.type, 'function')
    assert.equal(t.function.parameters.type, 'object')
  }
})
