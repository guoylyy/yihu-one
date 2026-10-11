<template>
  <!-- 数据卡片：以本人身份调一个只读工具，按 view 显示结果。全部用文本插值渲染，不出现 HTML -->
  <section class="yh-card data-card">
    <div class="yh-card-header">
      <div class="yh-card-title">{{ card.title || '数据' }}</div>
      <span class="yh-muted small">{{ at ? fromNow(at) : '' }}<el-button link size="small" :loading="loading" @click="load">刷新</el-button></span>
    </div>
    <div v-if="loading && !shown" class="yh-muted small pad">加载中…</div>
    <div v-else-if="error" class="yh-muted small pad">取不到数据：{{ error }}</div>
    <template v-else-if="shown">
      <div v-if="shown.kind === 'number'" class="big">{{ shown.value }}</div>
      <div v-else-if="shown.kind === 'text'" class="text">{{ shown.value }}</div>
      <ul v-else-if="shown.kind === 'list'" class="list">
        <li v-for="(v, i) in shown.items" :key="i">{{ v }}</li>
      </ul>
      <div v-else-if="shown.kind === 'table'" class="table-wrap">
        <table>
          <thead><tr><th v-for="c in shown.cols" :key="c">{{ c }}</th></tr></thead>
          <tbody><tr v-for="(r, i) in shown.rows" :key="i"><td v-for="c in shown.cols" :key="c">{{ cell(r[c]) }}</td></tr></tbody>
        </table>
        <div v-if="shown.more" class="yh-muted small">还有 {{ shown.more }} 条没显示</div>
      </div>
      <div v-else-if="shown.kind === 'line'" class="line">
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
          <polyline :points="shown.points" fill="none" stroke="var(--yh-primary)" stroke-width="2" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="axis yh-muted small"><span>{{ shown.first }}</span><span>最高 {{ shown.max }} · 最低 {{ shown.min }}</span><span>{{ shown.last }}</span></div>
      </div>
      <div v-else-if="shown.kind === 'kv'" class="kv">
        <template v-for="(v, k) in shown.obj" :key="k"><span class="k">{{ k }}</span><span>{{ cell(v) }}</span></template>
      </div>
      <div v-else class="yh-muted small pad">没有数据</div>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { meApi } from '@/api/me'
import { fromNow } from '@/utils/format'

const props = defineProps({ card: { type: Object, required: true } })
const W = 300
const H = 80
const raw = ref(undefined)
const at = ref('')
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await meApi.homeCardData(props.card.id)
    raw.value = r.result
    at.value = r.at
  } catch (e) {
    error.value = e.message || '出错了'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const cell = v => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 120))
/** field 是 a.b.c 这样的取值路径 */
function pick(v, field) {
  if (!field) return v
  return field.split('.').reduce((o, k) => (o == null ? o : o[k]), v)
}
/** 结果是对象、里面只有一个数组时，自动用那个数组（工具常返回 { total, list }） */
function firstArray(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const arrs = Object.values(v).filter(Array.isArray)
  return arrs.length === 1 ? arrs[0] : null
}

const shown = computed(() => {
  if (raw.value === undefined) return null
  const { view, x, y, field } = props.card
  let v = pick(raw.value, field)
  if (v == null) return { kind: 'empty' }
  if (view === 'number' || ((view === 'auto' || !view) && typeof v === 'number')) {
    const n = typeof v === 'number' ? v : Number(v?.total ?? v?.count ?? NaN)
    return Number.isFinite(n) ? { kind: 'number', value: n.toLocaleString() } : { kind: 'text', value: cell(v) }
  }
  if (typeof v !== 'object') return { kind: 'text', value: String(v) }
  const arr = Array.isArray(v) ? v : firstArray(v)
  if (view === 'line' && arr) {
    const pts = arr.map(r => ({ x: r?.[x], y: Number(r?.[y]) })).filter(p => Number.isFinite(p.y))
    if (pts.length < 2) return { kind: 'text', value: '数据点不够画折线（至少 2 个，检查 x / y 字段名）' }
    const min = Math.min(...pts.map(p => p.y)); const max = Math.max(...pts.map(p => p.y)); const span = max - min || 1
    const points = pts.map((p, i) => `${(i / (pts.length - 1)) * W},${H - 6 - ((p.y - min) / span) * (H - 12)}`).join(' ')
    return { kind: 'line', points, min: min.toLocaleString(), max: max.toLocaleString(), first: cell(pts[0].x), last: cell(pts[pts.length - 1].x) }
  }
  if (arr) {
    if (!arr.length) return { kind: 'empty' }
    if (view === 'list' || arr.every(r => r == null || typeof r !== 'object')) {
      return { kind: 'list', items: arr.slice(0, 10).map(r => (r && typeof r === 'object' ? (r.name ?? r.title ?? cell(r)) : cell(r))) }
    }
    const cols = [...new Set(arr.slice(0, 10).flatMap(r => Object.keys(r || {})))].slice(0, 5)
    return { kind: 'table', cols, rows: arr.slice(0, 8), more: Math.max(0, arr.length - 8) }
  }
  return { kind: 'kv', obj: Object.fromEntries(Object.entries(v).slice(0, 12)) }
})
</script>

<style scoped>
.small { font-size: 12px; }
.pad { padding: 8px 0; }
.big { font-size: 34px; font-weight: 600; color: var(--yh-primary); line-height: 1.2; }
.text { white-space: pre-wrap; line-height: 1.7; }
.list { margin: 0; padding-left: 18px; line-height: 1.9; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--yh-border-soft); white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
th { color: var(--yh-text-3); font-weight: 500; }
.line svg { width: 100%; height: 80px; display: block; }
.axis { display: flex; justify-content: space-between; margin-top: 4px; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; font-size: 13px; }
.kv .k { color: var(--yh-text-3); }
</style>
