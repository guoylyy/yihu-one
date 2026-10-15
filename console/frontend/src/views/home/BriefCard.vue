<template>
  <!-- 最新一次每日经营简报（定时任务的结果）；还没开通的给一个开通按钮 -->
  <section class="yh-card brief">
    <div class="yh-card-header">
      <div class="yh-card-title">{{ title || '最新简报' }}</div>
      <span v-if="brief" class="yh-muted small">
        {{ brief.scheduleText }}<template v-if="brief.lastRunAt"> · {{ when(brief.lastRunAt) }}</template>
      </span>
    </div>
    <div v-if="loading" class="yh-muted small">加载中…</div>
    <template v-else-if="!brief">
      <p class="intro">每天早上把公司的关键指标、风险和等您决定的事汇总成一屏，推到您的钉钉 / 飞书 / 企业微信。</p>
      <el-button type="primary" :loading="creating" @click="create">开通每日经营简报（工作日 8:00）</el-button>
    </template>
    <template v-else>
      <div v-if="brief.lastStatus === 'RUNNING'" class="yh-muted small">正在生成简报…（大约一分钟，好了自动显示）</div>
      <div v-else-if="brief.lastStatus === 'FAILED'" class="err">上次没生成出来：{{ brief.lastError }}</div>
      <div v-if="brief.lastResult" class="md" v-html="html"></div>
      <div class="foot">
        <el-button v-if="brief.lastConversationId" size="small" @click="openConv">查看全文、接着问</el-button>
        <el-button size="small" text :disabled="brief.lastStatus === 'RUNNING'" @click="runNow">现在生成一份</el-button>
        <span v-if="brief.lastError && brief.lastStatus === 'OK'" class="yh-muted small">{{ brief.lastError }}</span>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { renderMarkdown } from '@/utils/markdown'
import { meApi } from '@/api/me'

defineProps({ title: { type: String, default: '' } })
const router = useRouter()
const brief = ref(null)
const loading = ref(true)
const creating = ref(false)
let timer = null

// 简报是模型写的 Markdown：用聊天同一个安全渲染（原始 HTML 转义、只留安全链接）
const html = computed(() => renderMarkdown(brief.value?.lastResult || ''))
const when = iso => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function load() {
  try { brief.value = await meApi.latestBrief() } catch { /* 没开通或出错都按没有处理 */ } finally { loading.value = false }
  clearTimeout(timer)
  if (brief.value?.lastStatus === 'RUNNING') timer = setTimeout(load, 5000)
}
async function create() {
  creating.value = true
  try {
    brief.value = await meApi.createBrief({ kind: 'weekdays', time: '08:00' })
    ElMessage.success('已开通，正在生成第一份简报')
    timer = setTimeout(load, 5000)
  } finally {
    creating.value = false
  }
}
async function runNow() {
  await meApi.runTask(brief.value.id)
  brief.value = { ...brief.value, lastStatus: 'RUNNING' }
  timer = setTimeout(load, 5000)
}
function openConv() {
  const b = brief.value
  router.push({ path: '/assistant', query: { c: b.lastConversationId, ...(b.agentAppId ? { app: b.agentAppId } : {}) } })
}
onMounted(load)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<style scoped>
.intro { margin: 0 0 12px; font-size: 13.5px; color: var(--yh-text-2); line-height: 1.7; }
.err { font-size: 13px; color: var(--yh-danger); margin-bottom: 8px; }
.md { font-size: 13.5px; line-height: 1.75; max-height: 420px; overflow: auto; }
.md :deep(p) { margin: 0 0 8px; }
.md :deep(ul), .md :deep(ol) { margin: 0 0 8px; padding-left: 20px; }
.md :deep(strong) { color: var(--yh-text); }
.md :deep(a) { color: var(--yh-highlight); }
.md :deep(table) { border-collapse: collapse; margin: 6px 0; font-size: 12.5px; }
.md :deep(th), .md :deep(td) { border: 1px solid var(--yh-border); padding: 4px 8px; }
.foot { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.small { font-size: 12px; }
</style>
