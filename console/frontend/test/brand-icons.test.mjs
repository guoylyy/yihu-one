// 以虎官方图标：生成结果齐全、能渲染、和选择器分组对得上（node --test，不需要浏览器）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { BRAND, BRAND_ICONS } from '../src/utils/brand-icons.js'

const CODES = ['inbox', 'meeting', 'expiry', 'knowledge', 'hr', 'crm', 'fde', 'goods', 'training', 'finance', 'account', 'predict']
const KEYS = CODES.map(c => `brand-${c}`)

test('BRAND_ICONS 12 个键齐全', () => {
  assert.deepEqual(Object.keys(BRAND_ICONS).sort(), [...KEYS].sort())
})

test('每个组件都能渲染出带内容的 <svg>，class / style 落到根元素上', async () => {
  for (const key of KEYS) {
    const html = await renderToString(createSSRApp({ render: () => h(BRAND_ICONS[key], { class: 'svg', style: { width: '10px' } }) }))
    assert.match(html, /^<svg[^>]*viewBox="0 0 24 24"/, key)
    assert.match(html, /stroke="currentColor"/, key)
    assert.match(html, /class="svg"/, key)
    assert.match(html, /style="width:10px;?"/, key)
    assert.match(html, /<path /, key)
    assert.match(html, /<\/svg>$/, key)
  }
})

test('每个图标只有一处强调色，内容里只有 path', () => {
  for (const code of CODES) {
    assert.equal(BRAND[code].split('#d2521e').length, 2, code)
    assert.equal(BRAND[code].replace(/<path [^<>]*\/>/g, ''), '', code)
  }
})

test('图标选择器的分组和 BRAND_ICONS 一一对应，名字不重复', () => {
  const src = readFileSync(new URL('../src/utils/icons.js', import.meta.url), 'utf8')
  const options = [...src.matchAll(/\{ name: '(brand-[a-z]+)', label: '[^']+' \}/g)].map(m => m[1])
  assert.deepEqual(options, KEYS)
})
