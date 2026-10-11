// 标准 OIDC 的纯逻辑：发现文档、scope 与字段收敛、id_token 签名、PKCE
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const oidc = await import('../src/services/oidc.js')
const { pkceMatches } = await import('../src/services/apps.js')

const user = {
  id: 42, username: 'zhangsan', name: '张三', avatar: 'https://x/a.png', roles: ['MEMBER'],
  email: 'zs@example.com', mobile: '13800000000', depts: [{ id: 3, name: '研发部' }, { id: 5, name: '平台组' }]
}

test('发现文档：端点都挂在 issuer 下，只声明支持的能力', () => {
  const d = oidc.discovery('https://one.example.com')
  assert.equal(d.issuer, 'https://one.example.com')
  assert.equal(d.authorization_endpoint, 'https://one.example.com/sso/authorize')
  assert.equal(d.token_endpoint, 'https://one.example.com/api/oidc/token')
  assert.equal(d.jwks_uri, 'https://one.example.com/api/oidc/jwks')
  assert.deepEqual(d.response_types_supported, ['code'])
  assert.deepEqual(d.id_token_signing_alg_values_supported, ['RS256'])
  assert.ok(d.scopes_supported.includes('openid'))
})

test('scope：只认识支持的，忽略其他', () => {
  assert.deepEqual([...oidc.parseScopes('openid  profile offline_access email')], ['openid', 'profile', 'email'])
  assert.equal(oidc.parseScopes('').size, 0)
  assert.equal(oidc.parseScopes(undefined).size, 0)
})

test('字段：只给申请了的 scope', () => {
  const c = oidc.claimsFor(user, oidc.parseScopes('openid'), new Set(['org', 'contact']))
  assert.deepEqual(c, { sub: '42' }, 'sub 是字符串')
  const p = oidc.claimsFor(user, oidc.parseScopes('openid profile'), new Set())
  assert.equal(p.name, '张三')
  assert.equal(p.preferred_username, 'zhangsan')
  assert.deepEqual(p.roles, ['MEMBER'])
})

test('字段：邮箱、手机号、部门按应用能拿的范围收敛（员工发布的应用没授权就不给）', () => {
  const all = oidc.parseScopes('openid email phone groups')
  const none = oidc.claimsFor(user, all, new Set())
  assert.equal(none.email, undefined)
  assert.equal(none.phone_number, undefined)
  assert.equal(none.groups, undefined)
  const full = oidc.claimsFor(user, all, new Set(['org', 'contact']))
  assert.equal(full.email, 'zs@example.com')
  assert.equal(full.email_verified, true)
  assert.equal(full.phone_number, '13800000000')
  assert.deepEqual(full.groups, ['研发部', '平台组'])
  assert.equal(oidc.claimsFor({ ...user, email: null }, all, new Set(['contact'])).email, undefined, '没有邮箱就不给 email 字段')
})

test('id_token：RS256，用 jwks 里的公钥能验，带 kid / nonce / iss / aud', () => {
  const key = oidc.newKey()
  const t = oidc.signIdToken(key, { iss: 'https://one.example.com', aud: 'grafana', nonce: 'n-123', claims: { sub: '42', name: '张三' }, now: 1_000_000 })
  const header = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString())
  assert.equal(header.alg, 'RS256')
  assert.equal(header.kid, key.kid)
  const pub = crypto.createPublicKey({ key: { ...key.jwk }, format: 'jwk' })
  const p = jwt.verify(t, pub, { algorithms: ['RS256'], audience: 'grafana', issuer: 'https://one.example.com', clockTimestamp: 1_000_100 })
  assert.equal(p.sub, '42')
  assert.equal(p.nonce, 'n-123')
  assert.equal(p.exp - p.iat, 7200)
  assert.throws(() => jwt.verify(t, crypto.createPublicKey({ key: oidc.newKey().jwk, format: 'jwk' }), { algorithms: ['RS256'] }), '别的密钥验不过')
})

test('PKCE：S256 = base64url(sha256(verifier))（challenge 用 openssl 独立算出）', () => {
  const verifier = 'dBjftJeZ4CVP-mJ92K1RgQ6tY7KM2UvWVXfPIEdOvYo'
  const challenge = 'p4MYYZm-ZWcbw6BvdxjfuD7TpXu9rVrAcFCUqWgIJbU' // printf %s <verifier> | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '='
  assert.equal(pkceMatches(challenge, 'S256', verifier), true)
  assert.equal(pkceMatches(challenge, 'S256', verifier.slice(0, -1) + 'X'), false)
  assert.equal(pkceMatches(verifier, 'plain', verifier), true)
  assert.equal(pkceMatches(challenge, 'S256', undefined), false)
  assert.equal(pkceMatches(challenge, 'S256', 'short'), false, 'verifier 至少 43 位')
})
