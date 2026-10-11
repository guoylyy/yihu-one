// 开发中心文档注册表：构建时把 ../docs/devcenter/*.md 打包进前端（无需后端接口）
// 文件名即 slug：index.md → /dev，sso.md → /dev/sso。地址固定，会被贴进代码注释，不要改名。
import { parseFrontmatter } from '@/utils/markdown'

const files = import.meta.glob('../../../docs/devcenter/*.md', { query: '?raw', import: 'default', eager: true })

export const CATEGORY_ORDER = ['入门', '身份与认证', '应用能力', '系统集成', 'SDK 与示例', '案例', '参考']

export const docs = Object.entries(files)
  .map(([path, raw]) => {
    const slug = path.split('/').pop().replace(/\.md$/, '')
    const { meta, body } = parseFrontmatter(raw)
    return {
      slug,
      path: slug === 'index' ? '/dev' : `/dev/${slug}`,
      title: meta.title || slug,
      category: meta.category || '其他',
      order: typeof meta.order === 'number' ? meta.order : 999,
      summary: meta.summary || '',
      updated: meta.updated || '',
      body
    }
  })
  .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))

export function getDoc(slug) {
  return docs.find(d => d.slug === (slug || 'index')) || null
}

/** 左侧导航：按固定分类顺序分组，组内按 order */
export function groupedDocs() {
  const map = new Map()
  docs.forEach(d => {
    if (!map.has(d.category)) map.set(d.category, [])
    map.get(d.category).push(d)
  })
  const rank = c => {
    const i = CATEGORY_ORDER.indexOf(c)
    return i < 0 ? CATEGORY_ORDER.length : i
  }
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([category, items]) => ({ category, items }))
}
