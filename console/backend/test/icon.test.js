// 应用图标与配色的校验
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { validIcon, validColor, ICON_DATA_MAX } = await import('../src/lib/icon.js')

const bad = (fn, re) => assert.throws(fn, (e) => e.status === 400 && re.test(e.message))

test('图标：内置图标、emoji、图片地址原样保留，空值存 null', () => {
  assert.equal(validIcon('svg:chart'), 'svg:chart')
  assert.equal(validIcon(' 🧾 '), '🧾')
  assert.equal(validIcon('https://example.com/a.png'), 'https://example.com/a.png')
  assert.equal(validIcon(''), null)
  assert.equal(validIcon(null), null)
  assert.equal(validIcon(undefined), null)
})

test('图标：上传的图片（data URL）可以超过 500 字，但有上限、只收图片', () => {
  const png = 'data:image/png;base64,' + 'A'.repeat(8000)
  assert.equal(validIcon(png), png)
  assert.equal(validIcon('data:image/svg+xml;base64,PHN2Zy8+'), 'data:image/svg+xml;base64,PHN2Zy8+')
  bad(() => validIcon('data:image/png;base64,' + 'A'.repeat(ICON_DATA_MAX)), /太大/)
  bad(() => validIcon('data:text/html;base64,PHNjcmlwdD4='), /只支持/)
  bad(() => validIcon('data:image/png;base64,<script>'), /只支持/)
})

test('图标：非图片的文本最多 500 字', () => {
  bad(() => validIcon('x'.repeat(501)), /最多 500/)
})

test('颜色：#RRGGBB，统一小写，空值存 null', () => {
  assert.equal(validColor('#2563EB'), '#2563eb')
  assert.equal(validColor(''), null)
  assert.equal(validColor(null), null)
  bad(() => validColor('red'), /#RRGGBB/)
  bad(() => validColor('#fff'), /#RRGGBB/)
})
