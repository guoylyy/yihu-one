#!/usr/bin/env node
// 从设计仓库 yihu-brand 生成控制台内置的「以虎官方」图标（frontend/src/utils/brand-icons.js）。
// 产物提交进仓库，平时不用跑；设计稿改了才重新生成。
//   node console/scripts/gen-brand-icons.mjs [svg 目录，默认和本仓库同级的 yihu-brand/svg]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(process.argv[2] || join(here, '../../../yihu-brand/svg'))
const OUT = join(here, '../frontend/src/utils/brand-icons.js')
const ACCENT = '#d2521e'

// 图标选择器按这个顺序之外的名字不认识，所以设计稿增删图标要在这里一起改
const CODES = ['inbox', 'meeting', 'expiry', 'knowledge', 'hr', 'crm', 'fde', 'goods', 'training', 'finance', 'account', 'predict']

const die = (msg) => { console.error(`gen-brand-icons: ${msg}`); process.exit(1) }

const found = readdirSync(SRC).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4))
const diff = [...CODES.filter(c => !found.includes(c)), ...found.filter(c => !CODES.includes(c))]
if (diff.length) die(`${SRC} 和 CODES 对不上：${diff.join(' ')}`)

// 结果要用 innerHTML 塞进页面，所以只放行 <path/>，其它写法直接报错，不悄悄丢内容
function extract(code) {
  const svg = readFileSync(join(SRC, `${code}.svg`), 'utf8')
  const inner = svg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1]
  if (inner === undefined) die(`${code}.svg 不是完整的 <svg>`)
  const paths = inner.match(/<path\b[^<>]*\/>/g) || []
  if (inner.replace(/<path\b[^<>]*\/>/g, '').trim()) die(`${code}.svg 除了 <path/> 还有别的内容`)
  const out = paths.join('')
  if (out.includes("'") || /\son\w+=/i.test(out)) die(`${code}.svg 含不允许的字符或事件属性`)
  if (out.split(ACCENT).length !== 2) die(`${code}.svg 应该有且只有一处强调色 ${ACCENT}`)
  return out
}

const entries = CODES.map(c => `  ${c}: '${extract(c)}'`).join(',\n')

writeFileSync(OUT, `// 生成自 yihu-brand/svg，勿手改（console/scripts/gen-brand-icons.mjs）
import { defineComponent, h } from 'vue'

/** code → 图标内容。主结构跟 currentColor，强调色 ${ACCENT} 写死在 path 上，不随平台主色变 */
export const BRAND = {
${entries}
}

const brandIcon = (code) => defineComponent({
  name: \`Brand-\${code}\`,
  render: () => h('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    innerHTML: BRAND[code]
  })
})

/** \`brand-<code>\` → 组件，并入 utils/icons.js 的 ICONS */
export const BRAND_ICONS = Object.fromEntries(Object.keys(BRAND).map(code => [\`brand-\${code}\`, brandIcon(code)]))
`)
console.log(`已生成 ${OUT}（${CODES.length} 个图标）`)
