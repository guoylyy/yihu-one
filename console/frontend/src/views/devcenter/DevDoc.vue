<template>
  <div class="doc-page">
    <article v-if="doc" class="doc">
      <header class="doc-head">
        <div class="crumb">{{ doc.category }}</div>
        <h1>{{ doc.title }}</h1>
        <p v-if="doc.summary" class="summary">{{ doc.summary }}</p>
        <div v-if="doc.updated" class="updated">更新于 {{ doc.updated }}</div>
      </header>
      <div ref="bodyEl" class="md-doc" v-html="rendered.html" @click="onClick"></div>

      <nav class="pager">
        <router-link v-if="prev" :to="prev.path" class="pg prev"><span class="pg-label">上一篇</span><span class="pg-title">{{ prev.title }}</span></router-link>
        <span v-else></span>
        <router-link v-if="next" :to="next.path" class="pg next"><span class="pg-label">下一篇</span><span class="pg-title">{{ next.title }}</span></router-link>
      </nav>
    </article>

    <div v-else class="missing">
      <div class="missing-code">404</div>
      <h2>文档不存在</h2>
      <p class="yh-muted">没有找到「{{ slug }}」，可能已改名或删除。</p>
      <router-link to="/dev" class="el-button el-button--primary">返回开发中心首页</router-link>
    </div>

    <aside v-if="doc && rendered.toc.length" class="toc">
      <div class="toc-title">本页目录</div>
      <a
        v-for="t in rendered.toc"
        :key="t.id"
        :href="'#' + t.id"
        class="toc-item"
        :class="['lv' + t.level, { active: activeId === t.id }]"
        @click.prevent="scrollToId(t.id, true)"
      >{{ t.text }}</a>
    </aside>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { docs, getDoc } from '@/devcenter/docs'
import { renderDoc } from '@/utils/markdown'
import { copyText } from '@/utils/format'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const router = useRouter()
const appCfg = useAppStore()
const bodyEl = ref(null)
const activeId = ref('')

const slug = computed(() => route.params.slug || 'index')
const doc = computed(() => getDoc(slug.value))

// 正文第一行的 # 标题与 frontmatter title 重复，去掉（页头已显示 title）
function stripLeadingH1(body) {
  return body.replace(/^\s*#\s+[^\n]*\n/, '')
}
const rendered = computed(() => (doc.value ? renderDoc(stripLeadingH1(doc.value.body)) : { html: '', toc: [] }))

const flat = computed(() => docs)
const idx = computed(() => flat.value.findIndex(d => d.slug === slug.value))
const prev = computed(() => (idx.value > 0 ? flat.value[idx.value - 1] : null))
const next = computed(() => (idx.value >= 0 && idx.value < flat.value.length - 1 ? flat.value[idx.value + 1] : null))

const TOP_OFFSET = 64

function safeDecode(v) {
  try { return decodeURIComponent(v) } catch { return v }
}
const hashId = () => safeDecode(route.hash.slice(1))

function scrollToId(id, updateHash = false) {
  const el = document.getElementById(id)
  if (!el) return
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - TOP_OFFSET, behavior: 'smooth' })
  activeId.value = id
  if (updateHash) router.replace({ hash: '#' + id })
}

async function onClick(e) {
  const copyBtn = e.target.closest('[data-copy]')
  if (copyBtn) {
    const code = copyBtn.closest('.code-block')?.querySelector('code')?.innerText || ''
    if (await copyText(code)) {
      copyBtn.textContent = '已复制'
      setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
    } else {
      ElMessage.error('复制失败，请手动选择')
    }
    return
  }
  const a = e.target.closest('a')
  if (!a) return
  if (a.dataset.anchor) {
    e.preventDefault()
    scrollToId(safeDecode(a.getAttribute('href').slice(1)), true)
    return
  }
  if (a.dataset.internal) {
    // 带修饰键时让浏览器新开标签
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    router.push(a.getAttribute('href'))
  }
}

// 滚动时高亮当前目录项
function onScroll() {
  const items = rendered.value.toc
  if (!items.length) return
  let cur = items[0].id
  for (const t of items) {
    const el = document.getElementById(t.id)
    if (el && el.getBoundingClientRect().top - TOP_OFFSET - 8 <= 0) cur = t.id
  }
  activeId.value = cur
}

function updateTitle() {
  const t = doc.value?.title
  const site = `${appCfg.workspaceName}开发中心`
  document.title = !doc.value ? `文档不存在 · ${site}` : t === site || t === '以虎 One 开发中心' ? site : `${t} · ${site}`
}

watch(() => appCfg.workspaceName, updateTitle)

watch(slug, async () => {
  updateTitle()
  await nextTick()
  if (route.hash) scrollToId(hashId())
  else window.scrollTo({ top: 0 })
  onScroll()
})

onMounted(async () => {
  updateTitle()
  window.addEventListener('scroll', onScroll, { passive: true })
  await nextTick()
  if (route.hash) setTimeout(() => scrollToId(hashId()), 50)
  onScroll()
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<style scoped>
.doc-page { display: flex; gap: 40px; padding: 32px 40px 80px; }
.doc { flex: 1; min-width: 0; max-width: 820px; }
.doc-head { padding-bottom: 20px; margin-bottom: 24px; border-bottom: 1px solid var(--yh-border-soft); }
.crumb { font-size: 13px; color: var(--yh-primary); font-weight: 500; }
.doc-head h1 { font-size: 30px; line-height: 1.3; margin: 6px 0 10px; letter-spacing: .3px; }
.summary { font-size: 16px; color: var(--yh-text-2); margin: 0; line-height: 1.7; }
.updated { font-size: 12.5px; color: var(--yh-text-3); margin-top: 10px; }

.toc { width: 200px; flex-shrink: 0; position: sticky; top: calc(48px + 32px); align-self: flex-start; max-height: calc(100vh - 120px); overflow-y: auto; }
.toc-title { font-size: 12px; font-weight: 600; color: var(--yh-text-3); margin-bottom: 8px; }
.toc-item { display: block; font-size: 13px; color: var(--yh-text-2); padding: 4px 0 4px 10px; border-left: 2px solid var(--yh-border-soft); line-height: 1.5; }
.toc-item.lv3 { padding-left: 22px; font-size: 12.5px; }
.toc-item:hover { color: var(--yh-primary); }
.toc-item.active { color: var(--yh-primary); border-left-color: var(--yh-primary); font-weight: 500; }

.pager { display: flex; justify-content: space-between; gap: 12px; margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--yh-border-soft); }
.pg { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border: 1px solid var(--yh-border); border-radius: 10px; min-width: 0; max-width: 48%; }
.pg:hover { border-color: var(--el-color-primary-light-5); }
.pg.next { text-align: right; margin-left: auto; }
.pg-label { font-size: 12px; color: var(--yh-text-3); }
.pg-title { color: var(--yh-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.missing { flex: 1; text-align: center; padding: 12vh 16px; }
.missing-code { font-size: 56px; font-weight: 700; color: var(--el-color-primary-light-8); }
.missing h2 { margin: 8px 0; }

/* ---------- 正文排版 ---------- */
.md-doc { font-size: 15px; line-height: 1.8; color: #1f2937; word-break: break-word; }
.md-doc :deep(h2) { font-size: 22px; margin: 40px 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--yh-border-soft); scroll-margin-top: 64px; }
.md-doc :deep(h3) { font-size: 17px; margin: 28px 0 10px; scroll-margin-top: 64px; }
.md-doc :deep(h4) { font-size: 15px; margin: 20px 0 8px; }
.md-doc :deep(h2), .md-doc :deep(h3), .md-doc :deep(h4) { position: relative; }
.md-doc :deep(.anchor) { position: absolute; left: -1em; opacity: 0; color: var(--yh-text-3); font-weight: 400; text-decoration: none; }
.md-doc :deep(h2:hover .anchor), .md-doc :deep(h3:hover .anchor) { opacity: 1; }
.md-doc :deep(p) { margin: 0 0 14px; }
.md-doc :deep(ul), .md-doc :deep(ol) { padding-left: 22px; margin: 0 0 14px; }
.md-doc :deep(li) { margin: 4px 0; }
.md-doc :deep(a) { color: var(--yh-primary); text-decoration: none; border-bottom: 1px solid rgba(var(--yh-primary-rgb), .25); }
.md-doc :deep(a:hover) { border-bottom-color: var(--yh-primary); }
.md-doc :deep(a[download])::after { content: ' ⤓'; font-size: 12px; }
.md-doc :deep(blockquote) { margin: 0 0 14px; padding: 8px 16px; border-left: 3px solid var(--el-color-primary-light-5); background: var(--yh-fill); color: var(--yh-text-2); border-radius: 0 8px 8px 0; }
.md-doc :deep(blockquote p:last-child) { margin-bottom: 0; }
.md-doc :deep(:not(pre) > code) { background: #f1f5f9; color: #be185d; padding: 1px 6px; border-radius: 4px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.md-doc :deep(hr) { border: none; border-top: 1px solid var(--yh-border); margin: 28px 0; }
.md-doc :deep(img) { max-width: 100%; }
.md-doc :deep(.table-wrap) { overflow-x: auto; margin: 0 0 16px; }
.md-doc :deep(table) { border-collapse: collapse; font-size: 14px; min-width: 100%; }
.md-doc :deep(th), .md-doc :deep(td) { border: 1px solid var(--yh-border); padding: 8px 12px; text-align: left; vertical-align: top; }
.md-doc :deep(th) { background: var(--yh-fill); font-weight: 600; white-space: nowrap; }
.md-doc :deep(.code-block) { margin: 0 0 16px; border-radius: 10px; overflow: hidden; background: #0f172a; }
.md-doc :deep(.code-bar) { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px 6px 14px; background: #1e293b; }
.md-doc :deep(.code-lang) { font-size: 12px; color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.md-doc :deep(.code-copy) { font-size: 12px; color: #cbd5e1; background: transparent; border: 1px solid #334155; border-radius: 5px; padding: 2px 10px; cursor: pointer; font-family: inherit; }
.md-doc :deep(.code-copy:hover) { color: #fff; border-color: #64748b; }
.md-doc :deep(pre) { margin: 0; padding: 14px 16px; overflow-x: auto; color: #e2e8f0; font-size: 13px; line-height: 1.6; }
.md-doc :deep(pre code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

@media (max-width: 1100px) {
  .toc { display: none; }
}
@media (max-width: 767px) {
  .doc-page { padding: 20px 16px 60px; }
  .doc-head h1 { font-size: 24px; }
  .summary { font-size: 15px; }
  .md-doc { font-size: 15px; }
  .md-doc :deep(h2) { font-size: 19px; margin-top: 32px; }
  .md-doc :deep(.anchor) { display: none; }
  .pager { flex-direction: column; }
  .pg { max-width: none; }
}
</style>
