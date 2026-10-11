// Markdown 渲染：禁用原始 HTML、过滤危险链接；站内链接由组件拦截走路由
// - renderMarkdown：助手聊天用
// - renderDoc：开发中心文档用（标题锚点 + 目录 + 代码复制按钮 + /sdk 下载链接），安全处理相同
import { Marked } from 'marked'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function safeHref(href) {
  if (!href) return ''
  const h = String(href).trim()
  if (/^(https?:|mailto:|tel:|\/(?!\/)|#)/i.test(h)) return h
  return ''
}

// 两个实例共用的安全渲染器：原始 HTML 一律转义；链接只允许 http(s)/mailto/tel/站内/锚点
const safeRenderer = {
  html({ text }) {
    return escapeHtml(text)
  },
  link({ href, title, tokens }) {
    const inner = this.parser.parseInline(tokens)
    const url = safeHref(href)
    if (!url) return inner
    const t = title ? ` title="${escapeHtml(title)}"` : ''
    if (url.startsWith('#')) return `<a href="${escapeHtml(url)}" data-anchor="1"${t}>${inner}</a>`
    // /sdk/* 是前端 public 下的静态文件：直接下载
    if (url.startsWith('/sdk/')) return `<a href="${escapeHtml(url)}" download${t}>${inner}</a>`
    if (url.startsWith('/')) return `<a href="${escapeHtml(url)}" data-internal="1"${t}>${inner}</a>`
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${t}>${inner}</a>`
  },
  image({ href, text }) {
    const url = safeHref(href)
    return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(text || '')}" />` : escapeHtml(text || '')
  }
}

const md = new Marked({ gfm: true, breaks: true })
md.use({ renderer: safeRenderer })

export function renderMarkdown(text) {
  if (!text) return ''
  try {
    return md.parse(String(text))
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>')
  }
}

// ---------------- 文档 ----------------

/** 标题 → 锚点 id（保留中文） */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/，。、：；！？（）【】《》“”‘’·]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'section'
}

/**
 * 渲染文档
 * @returns {{ html: string, toc: Array<{ level: number, text: string, id: string }>, title: string }}
 */
export function renderDoc(text) {
  const toc = []
  const used = new Map()
  let firstH1 = ''
  const docMd = new Marked({ gfm: true, breaks: false })
  docMd.use({
    renderer: {
      ...safeRenderer,
      heading({ tokens, depth, text: raw }) {
        const inner = this.parser.parseInline(tokens)
        const plain = inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        let id = slugify(plain || raw)
        const n = used.get(id) || 0
        used.set(id, n + 1)
        if (n) id = `${id}-${n}`
        if (depth === 1 && !firstH1) firstH1 = plain
        if (depth === 2 || depth === 3) toc.push({ level: depth, text: plain, id })
        return `<h${depth} id="${escapeHtml(id)}"><a class="anchor" href="#${escapeHtml(id)}" data-anchor="1" aria-hidden="true">#</a>${inner}</h${depth}>\n`
      },
      code({ text: code, lang }) {
        const l = (lang || '').split(/\s+/)[0]
        return `<div class="code-block"><div class="code-bar"><span class="code-lang">${escapeHtml(l)}</span><button type="button" class="code-copy" data-copy="1">复制</button></div><pre><code${l ? ` class="language-${escapeHtml(l)}"` : ''}>${escapeHtml(code)}</code></pre></div>\n`
      },
      table(token) {
        // 包一层以便窄屏横向滚动
        const header = token.header.map(c => `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`).join('')
        const rows = token.rows.map(r => `<tr>${r.map(c => `<td${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('')
        return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>\n`
      }
    }
  })
  let html = ''
  try {
    html = docMd.parse(String(text || ''))
  } catch {
    html = `<pre>${escapeHtml(text)}</pre>`
  }
  return { html, toc, title: firstH1 }
}

/** 解析 YAML frontmatter（只支持 key: value 单行） */
export function parseFrontmatter(raw) {
  const src = String(raw || '').replace(/^﻿/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { meta: {}, body: src }
  const meta = {}
  m[1].split(/\r?\n/).forEach(line => {
    const mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!mm) return
    let v = mm[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    meta[mm[1]] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
  })
  return { meta, body: src.slice(m[0].length) }
}
