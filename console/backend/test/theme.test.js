import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, resolve, normalizeBrand, resolveBrand, PRESETS, TOKENS, DEFAULT_PRESET } from '../src/services/theme.js'

test('预设完整：每个预设都有全部令牌', () => {
  for (const [k, p] of Object.entries(PRESETS)) {
    assert.deepEqual(Object.keys(p.tokens).sort(), Object.keys(TOKENS).sort(), `预设 ${k} 缺令牌`)
    assert.equal(normalize({ preset: k, tokens: p.tokens }).tokens && Object.keys(normalize({ preset: k, tokens: p.tokens }).tokens).length, 0)
  }
})

test('默认是以虎 VI；只存改过的项，生效值 = 预设 + 改过的', () => {
  assert.equal(DEFAULT_PRESET, 'yihu')
  assert.equal(resolve(null).preset, 'yihu')
  assert.equal(resolve(null).tokens.highlight, '#d2521e')
  const n = normalize({ preset: 'yihu', tokens: { primary: '#0A3D62', highlight: PRESETS.yihu.tokens.highlight, bogus: 1, radius: '6' } })
  assert.deepEqual(n, { preset: 'yihu', tokens: { primary: '#0a3d62', radius: 6 } })
  const r = resolve(n)
  assert.equal(r.tokens.primary, '#0a3d62')
  assert.equal(r.tokens.bg, PRESETS.yihu.tokens.bg)
  assert.deepEqual(r.custom.sort(), ['primary', 'radius'])
  assert.equal(normalize({ preset: 'nope' }).preset, 'yihu')
})

test('非法值拒绝', () => {
  assert.throws(() => normalize({ preset: 'yihu', tokens: { primary: 'red' } }), /颜色/)
  assert.throws(() => normalize({ preset: 'yihu', tokens: { radius: 99 } }), /0~24/)
  assert.throws(() => normalize({ preset: 'yihu', tokens: { shadow: 'huge' } }), /只能是/)
  assert.throws(() => normalize('x'), /preset/)
  assert.equal(normalize(null), null)
})

test('老平台改过主色：按经典蓝 + 那个主色显示；设了 VI 后以 VI 为准', () => {
  const r = resolve(null, '#16A34A')
  assert.equal(r.preset, 'classic')
  assert.equal(r.tokens.primary, '#16a34a')
  assert.equal(resolve({ preset: 'yihu', tokens: {} }, '#16a34a').preset, 'yihu')
})

test('空间品牌：全空 = 跟随平台；图片只收图片', () => {
  assert.equal(normalizeBrand({ name: ' ', logo: '' }), null)
  assert.equal(resolveBrand(null), null)
  const b = normalizeBrand({ name: '示例工作台', theme: { preset: 'classic', tokens: { primary: '#0f766e' } } })
  assert.deepEqual(b, { name: '示例工作台', theme: { preset: 'classic', tokens: { primary: '#0f766e' } } })
  assert.equal(resolveBrand(b).theme.tokens.primary, '#0f766e')
  assert.equal(resolveBrand({ name: 'x' }).theme, null)
  assert.throws(() => normalizeBrand({ logo: 'javascript:alert(1)' }), /LOGO/)
  assert.throws(() => normalizeBrand({ logo: 'data:text/html;base64,PGI+' }), /LOGO/)
})

test('经典蓝只改主色：强调色跟着主色；以虎 VI 的强调色不跟', () => {
  assert.equal(resolve({ preset: 'classic', tokens: { primary: '#0f766e' } }).tokens.highlight, '#0f766e')
  assert.equal(resolve({ preset: 'classic', tokens: { primary: '#0f766e', highlight: '#e11d48' } }).tokens.highlight, '#e11d48')
  assert.equal(resolve({ preset: 'yihu', tokens: { primary: '#0a3d62' } }).tokens.highlight, '#d2521e')
})
