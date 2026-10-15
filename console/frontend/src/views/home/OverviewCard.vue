<template>
  <!-- 管理层首页的三张卡：关键指标 / 待我决策 / 风险与动态。数据来自各应用的标准工具（后端 services/overview.js），三张卡共用一次请求 -->
  <section class="yh-card ov">
    <div class="yh-card-header">
      <div class="yh-card-title">{{ title || DEFAULT_TITLE[type] }}<span v-if="type !== 'metrics' && items.length" class="count">{{ items.length }}</span></div>
      <span v-if="data" class="yh-muted small">{{ fromNow(data.generatedAt) }}</span>
    </div>
    <div v-if="loading" class="yh-muted small">正在汇总各应用的数据…</div>
    <div v-else-if="error" class="yh-muted small">没取到：{{ error }}</div>
    <div v-else-if="data && !data.hasSources" class="empty">
      还没有应用提供经营数据。应用实现了「标准工具」就会出现在这里，见开发中心
      <a href="/dev/briefing" target="_blank" rel="noopener">让应用出现在老板的简报里</a>。
    </div>
    <template v-else-if="type === 'metrics'">
      <div v-if="!items.length" class="yh-muted small">暂无指标</div>
      <div class="tiles">
        <component :is="m.url ? 'a' : 'div'" v-for="(m, i) in items" :key="i" class="tile" :href="m.url || undefined" target="_blank" rel="noopener">
          <div class="t-name">{{ m.name }}</div>
          <div class="t-value yh-num">{{ fmt(m.value) }}<small v-if="m.unit">{{ m.unit }}</small></div>
          <div class="t-foot">
            <span v-if="m.change !== null && m.change !== undefined" class="chg" :class="m.good === true ? 'good' : m.good === false ? 'bad' : ''">
              {{ m.trend === 'down' ? '↓' : m.trend === 'up' ? '↑' : '' }}{{ fmt(m.change) }}
            </span>
            <span class="app">{{ m.app }}</span>
          </div>
        </component>
      </div>
    </template>
    <template v-else>
      <div v-if="!items.length" class="yh-muted small">{{ type === 'decisions' ? '没有等您决定的事' : '没有新的变化' }}</div>
      <ul class="rows">
        <li v-for="(r, i) in items.slice(0, 8)" :key="i">
          <span v-if="type === 'events'" class="lv" :class="r.level">{{ LEVEL[r.level] }}</span>
          <div class="r-main">
            <component :is="r.url ? 'a' : 'span'" :href="r.url || undefined" target="_blank" rel="noopener" class="r-title">{{ r.title }}</component>
            <div class="r-sub">
              <template v-if="type === 'decisions'">{{ [r.requester, r.deadline && `截止 ${r.deadline}`].filter(Boolean).join(' · ') }}</template>
              <template v-else>{{ r.detail }}</template>
              <span class="app">{{ r.app }}</span>
            </div>
          </div>
        </li>
      </ul>
      <div v-if="items.length > 8" class="yh-muted small">还有 {{ items.length - 8 }} 条，问老板助理看全部</div>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { meApi } from '@/api/me'

const props = defineProps({ type: { type: String, required: true }, title: { type: String, default: '' } })
const DEFAULT_TITLE = { metrics: '关键指标', decisions: '待我决策', events: '风险与动态' }
const LEVEL = { risk: '风险', warn: '注意', info: '动态' }

// 同一页上三张卡共用一次请求（后端也按人缓存一分钟）
let shared = null
let sharedAt = 0
function load() {
  if (!shared || Date.now() - sharedAt > 30_000) { shared = meApi.overview(); sharedAt = Date.now() }
  return shared
}

const data = ref(null)
const loading = ref(true)
const error = ref('')
const items = computed(() => (data.value ? data.value[props.type] || [] : []))
const fmt = v => (typeof v === 'number' ? v.toLocaleString() : v)
function fromNow(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? '刚刚更新' : `${m} 分钟前更新`
}

onMounted(async () => {
  try { data.value = await load() } catch (e) { error.value = e.message || '出错了' } finally { loading.value = false }
})
</script>

<script>
export default { name: 'OverviewCard' }
</script>

<style scoped>
.count { margin-left: 6px; color: var(--yh-highlight); font-weight: 600; }
.empty { font-size: 13px; color: var(--yh-text-2); line-height: 1.7; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.tile { display: block; border: 1px solid var(--yh-border); border-radius: var(--yh-radius-sm); padding: 12px 14px; color: var(--yh-text); background: var(--yh-card); }
a.tile:hover { border-color: var(--yh-border-strong); }
.t-name { font-size: 12px; color: var(--yh-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.t-value { font-size: 24px; font-weight: 800; margin-top: 4px; line-height: 1.2; }
.t-value small { font-size: 12px; font-weight: 600; margin-left: 2px; color: var(--yh-text-2); }
.t-foot { display: flex; justify-content: space-between; gap: 6px; margin-top: 6px; font-size: 11.5px; }
.chg { color: var(--yh-text-2); font-family: var(--yh-font-num); }
.chg.good { color: var(--yh-success); }
.chg.bad { color: var(--yh-danger); }
.app { color: var(--yh-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rows { list-style: none; margin: 0; padding: 0; }
.rows li { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--yh-border-soft); }
.rows li:last-child { border-bottom: none; }
.lv { flex-shrink: 0; font-size: 11px; line-height: 18px; padding: 0 6px; border-radius: 4px; height: 18px; margin-top: 2px; color: var(--yh-text-2); background: var(--yh-fill-2); }
.lv.risk { color: var(--yh-on-primary); background: var(--yh-danger); }
.lv.warn { color: var(--yh-warning); background: var(--yh-fill-2); }
.r-main { min-width: 0; flex: 1; }
.r-title { font-size: 13.5px; color: var(--yh-text); display: block; }
a.r-title:hover { color: var(--yh-highlight); }
.r-sub { font-size: 12px; color: var(--yh-text-3); display: flex; gap: 8px; justify-content: space-between; margin-top: 2px; }
.small { font-size: 12px; }
</style>
