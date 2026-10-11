// 资料中心：文件名、品牌规范的校验（不可信输入），下载签名
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { safeName, mimeOf, normalizeSpec, signFile, verifyFile, CATEGORIES } = await import('../src/services/assets.js')

test('四个类别', () => {
  assert.deepEqual(Object.keys(CATEGORIES), ['TEMPLATE', 'BRAND', 'COMPONENT', 'OTHER'])
})

test('文件名：去掉路径（防穿越）、去掉危险字符，可执行文件拒绝', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd')
  assert.equal(safeName('C:\\\\Users\\\\x\\\\公司模板.pptx'), '公司模板.pptx')
  assert.equal(safeName('a"<b>.png'), 'ab.png')
  for (const bad of ['tool.exe', 'install.sh', 'x.app', 'run.bat']) assert.throws(() => safeName(bad), /可执行文件/, bad)
  assert.throws(() => safeName('..'), /不合法/)
  assert.throws(() => safeName(''), /不合法/)
})

test('文件类型按扩展名定，不认识的当二进制', () => {
  assert.equal(mimeOf('模板.PPTX'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  assert.equal(mimeOf('logo.svg'), 'image/svg+xml')
  assert.equal(mimeOf('x.unknown'), 'application/octet-stream')
})

test('品牌规范：只留认识的字段，颜色必须 #RRGGBB，限长', () => {
  const s = normalizeSpec({ colors: [{ name: '以虎蓝', hex: '#2563EB', usage: '主色' }], fonts: [{ name: '思源黑体', usage: '正文' }, { usage: '没名字的丢掉' }], rules: ['Logo 四周留白不小于 Logo 高度的 1/4', ''], voice: '专业、简洁', html: '<script>' })
  assert.deepEqual(s.colors, [{ name: '以虎蓝', hex: '#2563eb', usage: '主色' }])
  assert.equal(s.fonts.length, 1)
  assert.deepEqual(s.rules, ['Logo 四周留白不小于 Logo 高度的 1/4'])
  assert.equal(s.html, undefined)
  assert.throws(() => normalizeSpec({ colors: [{ name: '红', hex: 'red' }] }), /#RRGGBB/)
  assert.equal(normalizeSpec(null), null)
  assert.equal(normalizeSpec({}), null)
  assert.throws(() => normalizeSpec('x'), /对象/)
})

test('下载签名：对的能过、改了任何一项都不过、过期不过', () => {
  const now = Math.floor(Date.now() / 1000)
  const q = signFile(12, 7, now + 60)
  assert.equal(verifyFile(12, q), 7)
  assert.equal(verifyFile(13, q), null, '换文件')
  assert.equal(verifyFile(12, { ...q, u: 8 }), null, '换人')
  assert.equal(verifyFile(12, { ...q, exp: now + 6000 }), null, '改过期时间')
  assert.equal(verifyFile(12, signFile(12, 7, now - 1)), null, '过期')
  assert.equal(verifyFile(12, {}), null)
})
