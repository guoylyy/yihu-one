<template>
  <el-drawer
    :model-value="modelValue"
    :size="isMobile ? '100%' : 760"
    :with-header="false"
    append-to-body
    class="usage-drawer"
    @update:model-value="v => emit('update:modelValue', v)"
    @open="load"
  >
    <div class="wrap">
      <div class="head">
        <AppIcon :icon="app?.icon" :name="app?.name" :color="app?.iconColor" :size="36" />
        <div class="yh-grow">
          <div class="title">{{ app?.name }} · 使用数据</div>
          <div class="yh-muted small">{{ app?.code }}</div>
        </div>
        <el-radio-group v-model="days" size="small" @change="load">
          <el-radio-button :value="7">7 天</el-radio-button>
          <el-radio-button :value="30">30 天</el-radio-button>
          <el-radio-button :value="90">90 天</el-radio-button>
        </el-radio-group>
        <el-button text circle @click="emit('update:modelValue', false)"><el-icon><Close /></el-icon></el-button>
      </div>

      <div v-loading="loading" class="content">
        <template v-if="data">
          <el-alert v-if="data.reportsUsage === false" type="warning" :closable="false" show-icon class="mb">
            <template #title>
              该应用还没有上报使用数据，接入方法见开发中心
              <a href="/dev/usage" target="_blank" rel="noopener" class="link">/dev/usage</a>
            </template>
          </el-alert>

          <div class="kpis">
            <div class="kpi"><div class="k-label">使用人数</div><div class="k-val">{{ data.totals?.users ?? 0 }}</div></div>
            <div class="kpi"><div class="k-label">打开次数</div><div class="k-val">{{ data.totals?.launches ?? 0 }}</div><div class="k-sub">从工作台点开</div></div>
            <div class="kpi" :class="{ grey: !data.totals?.appEvents }"><div class="k-label">应用上报事件</div><div class="k-val">{{ data.totals?.appEvents ?? 0 }}</div><div class="k-sub">应用内的操作</div></div>
          </div>

          <!-- 按天趋势 -->
          <section class="sec">
            <div class="sec-head">
              <span class="sec-title">按天趋势</span>
              <span class="legend"><i class="lg launches"></i>打开 <i class="lg events"></i>应用事件</span>
            </div>
            <div class="chart" :class="{ dense: byDay.length > 40 }">
              <div v-for="d in byDay" :key="d.date" class="col" :title="`${d.date}\n打开 ${d.launches}  事件 ${d.events}  人数 ${d.users}`">
                <div class="bars">
                  <div class="bar launches" :style="{ height: h(d.launches) }"></div>
                  <div class="bar events" :style="{ height: h(d.events) }"></div>
                </div>
              </div>
            </div>
            <div class="axis">
              <span>{{ byDay[0]?.date }}</span>
              <span class="yh-muted">峰值 {{ maxDay }}</span>
              <span>{{ byDay[byDay.length - 1]?.date }}</span>
            </div>
          </section>

          <!-- AI 用量(应用通过平台开放接口调用大模型) -->
          <section class="sec">
            <div class="sec-head">
              <span class="sec-title">AI 用量</span>
              <a href="/dev/llm" target="_blank" rel="noopener" class="small link">接入文档 /dev/llm</a>
            </div>
            <div v-if="!data.llm?.totals?.calls" class="yh-empty">暂无大模型调用</div>
            <template v-else>
              <div class="kpis llm-kpis">
                <div class="kpi"><div class="k-label">调用次数</div><div class="k-val">{{ fmt(data.llm.totals.calls) }}</div></div>
                <div class="kpi"><div class="k-label">Token 总量</div><div class="k-val">{{ fmt(data.llm.totals.tokens) }}</div></div>
                <div class="kpi" :class="{ grey: !data.llm.totals.errors }"><div class="k-label">失败次数</div><div class="k-val">{{ data.llm.totals.errors }}</div></div>
              </div>

              <!-- Token 按天 -->
              <div class="chart llm-chart" :class="{ dense: llmByDay.length > 40 }">
                <div v-for="d in llmByDay" :key="d.date" class="col" :title="`${d.date}\n调用 ${d.calls}  token ${d.tokens}`">
                  <div class="bars">
                    <div class="bar tokens" :style="{ height: llmH(d.tokens) }"></div>
                  </div>
                </div>
              </div>
              <div class="axis">
                <span>{{ llmByDay[0]?.date }}</span>
                <span class="yh-muted">峰值 {{ fmt(maxLlmTokens) }} tokens</span>
                <span>{{ llmByDay[llmByDay.length - 1]?.date }}</span>
              </div>

              <div class="two llm-two">
                <!-- 按模型 -->
                <section class="llm-sub">
                  <div class="sec-head"><span class="sec-title sub-title">按模型</span></div>
                  <div v-for="m in data.llm.byModel" :key="m.model" class="hbar">
                    <span class="hb-label mono" :title="m.model">{{ m.model }}</span>
                    <div class="hb-track"><div class="hb-fill llm-fill" :style="{ width: pct(m.tokens, maxModelTokens) }"></div></div>
                    <span class="hb-num">{{ fmt(m.tokens) }}</span>
                  </div>
                </section>

                <!-- AI 活跃用户 -->
                <section class="llm-sub">
                  <div class="sec-head"><span class="sec-title sub-title">AI 活跃用户 Top</span></div>
                  <div v-for="(u, i) in data.llm.topUsers" :key="u.user?.id || i" class="user-row">
                    <span class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</span>
                    <UserAvatar :user="u.user" :size="24" />
                    <span class="yh-grow yh-ellipsis">{{ u.user?.name || '未知' }}</span>
                    <b class="u-count">{{ fmt(u.tokens) }}</b>
                  </div>
                </section>
              </div>
            </template>
          </section>

          <div class="two">
            <!-- 动作分布 -->
            <section class="sec">
              <div class="sec-head"><span class="sec-title">动作分布</span></div>              <div v-if="!data.byAction?.length" class="yh-empty">暂无</div>
              <div v-for="a in data.byAction || []" :key="a.action" class="hbar">
                <span class="hb-label mono" :title="a.action">{{ a.action }}</span>
                <div class="hb-track"><div class="hb-fill" :style="{ width: pct(a.count, maxAction) }"></div></div>
                <span class="hb-num">{{ a.count }}</span>
              </div>
            </section>

            <!-- 活跃用户 -->
            <section class="sec">
              <div class="sec-head"><span class="sec-title">活跃用户 Top</span></div>
              <div v-if="!data.topUsers?.length" class="yh-empty">暂无</div>
              <div v-for="(u, i) in data.topUsers || []" :key="u.user?.id || i" class="user-row">
                <span class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</span>
                <UserAvatar :user="u.user" :size="24" />
                <span class="yh-grow yh-ellipsis">{{ u.user?.name || '未知' }}</span>
                <span class="yh-muted small">{{ fromNow(u.lastAt) }}</span>
                <b class="u-count">{{ u.count }}</b>
              </div>
            </section>
          </div>

          <!-- 最近事件 -->
          <section class="sec">
            <div class="sec-head"><span class="sec-title">最近事件</span></div>
            <el-table :data="data.recent || []" size="small" empty-text="暂无事件">
              <el-table-column label="时间" width="140"><template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template></el-table-column>
              <el-table-column label="用户" width="110">
                <template #default="{ row }"><span class="yh-flex"><UserAvatar :user="row.user" :size="20" />{{ row.user?.name || '-' }}</span></template>
              </el-table-column>
              <el-table-column label="动作" min-width="120"><template #default="{ row }"><span class="mono">{{ row.action }}</span></template></el-table-column>
              <el-table-column label="来源" width="90">
                <template #default="{ row }">
                  <el-tag v-if="row.source === 'APP'" size="small" type="success" effect="plain">应用上报</el-tag>
                  <el-tag v-else size="small" type="info" effect="plain">控制台</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="详情" min-width="220">
                <template #default="{ row }">
                  <el-tooltip v-if="row.detail" placement="top-start" :show-after="300">
                    <template #content><pre class="tip-json">{{ prettyJson(row.detail) }}</pre></template>
                    <code class="detail">{{ compact(row.detail) }}</code>
                  </el-tooltip>
                  <span v-else class="yh-muted">-</span>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </template>
      </div>
    </div>
  </el-drawer>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Close } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { appApi } from '@/api/apps'
import { formatDateTime, fromNow } from '@/utils/format'
import { prettyJson } from '@/utils/json'
import { useMobile } from '@/utils/useMobile'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  app: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue'])
const isMobile = useMobile()

const days = ref(30)
const data = ref(null)
const loading = ref(false)

const byDay = computed(() => data.value?.byDay || [])
const maxDay = computed(() => Math.max(0, ...byDay.value.map(d => Math.max(d.launches || 0, d.events || 0))))
const maxAction = computed(() => Math.max(1, ...(data.value?.byAction || []).map(a => a.count || 0)))

// AI 用量
const llmByDay = computed(() => data.value?.llm?.byDay || [])
const maxLlmTokens = computed(() => Math.max(0, ...llmByDay.value.map(d => d.tokens || 0)))
const maxModelTokens = computed(() => Math.max(1, ...(data.value?.llm?.byModel || []).map(m => m.tokens || 0)))
const llmH = v => (maxLlmTokens.value ? `${Math.max(v ? 4 : 0, (v / maxLlmTokens.value) * 100)}%` : '0')
const fmt = v => Number(v || 0).toLocaleString('zh-CN')

const h = v => (maxDay.value ? `${Math.max(v ? 4 : 0, (v / maxDay.value) * 100)}%` : '0')
const pct = (v, m) => `${(v / m) * 100}%`

/** 紧凑 JSON：{a: 1, b: "x"} 一行显示 */
function compact(v) {
  try {
    return JSON.stringify(v).replace(/"([^"]+)":/g, '$1: ').replace(/,/g, ', ')
  } catch {
    return String(v)
  }
}

async function load() {
  if (!props.app?.id) return
  loading.value = true
  try {
    data.value = await appApi.usage(props.app.id, days.value)
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.wrap { display: flex; flex-direction: column; height: 100%; }
.head { display: flex; align-items: center; gap: 12px; padding: 14px 16px 12px 20px; border-bottom: 1px solid var(--yh-border-soft); flex-wrap: wrap; }
.title { font-weight: 600; font-size: 16px; }
.small { font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.content { flex: 1; overflow-y: auto; padding: 16px 20px 24px; }
.mb { margin-bottom: 14px; }
.link { margin-left: 4px; font-weight: 500; }

.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.kpi { border: 1px solid var(--yh-border-soft); border-radius: 12px; padding: 14px 16px; background: var(--yh-card); }
.kpi.grey { background: #f9fafb; }
.kpi.grey .k-val { color: var(--yh-text-3); }
.k-label { font-size: 13px; color: var(--yh-text-3); }
.k-val { font-size: 26px; font-weight: 600; margin-top: 4px; }
.k-sub { font-size: 11.5px; color: var(--yh-text-3); }

.sec { margin-top: 20px; }
.sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.sec-title { font-weight: 600; }
.legend { font-size: 12px; color: var(--yh-text-3); display: flex; align-items: center; gap: 4px; }
.lg { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-left: 8px; }
.lg.launches, .bar.launches { background: var(--yh-primary-light); }
.lg.events, .bar.events { background: #34d399; }
.bar.tokens { background: #a78bfa; }

.chart { display: flex; align-items: flex-end; gap: 4px; height: 140px; padding: 8px 4px 0; border-bottom: 1px solid var(--yh-border); background: repeating-linear-gradient(to top, transparent 0, transparent 34px, #f1f5f9 34px, #f1f5f9 35px); }
.chart.dense { gap: 1px; }
.col { flex: 1; height: 100%; display: flex; align-items: flex-end; min-width: 0; }
.col:hover { background: rgba(var(--yh-primary-rgb), .05); }
.bars { display: flex; align-items: flex-end; gap: 1px; width: 100%; height: 100%; justify-content: center; }
.bar { flex: 1; max-width: 12px; border-radius: 2px 2px 0 0; transition: height .3s; }
.axis { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--yh-text-3); margin-top: 4px; }

.two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.llm-kpis { grid-template-columns: repeat(3, 1fr); margin-bottom: 4px; }
.llm-two { margin-top: 14px; }
.llm-sub .sub-title { font-size: 14px; }
.hb-fill.llm-fill { background: linear-gradient(90deg, #c4b5fd, #8b5cf6); }
.hbar { display: grid; grid-template-columns: 120px 1fr 36px; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
.hb-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hb-track { height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
.hb-fill { height: 100%; background: linear-gradient(90deg, var(--el-color-primary-light-5), var(--yh-primary)); border-radius: 4px; }
.hb-num { text-align: right; }
.user-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; }
.rank { width: 18px; text-align: center; font-size: 12px; color: var(--yh-text-3); }
.rank.top { color: var(--yh-primary); font-weight: 600; }
.u-count { min-width: 28px; text-align: right; }
.detail { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--yh-text-2); background: var(--yh-fill); padding: 1px 6px; border-radius: 4px; display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.tip-json { margin: 0; font-size: 12px; max-width: 420px; white-space: pre-wrap; word-break: break-all; }

@media (max-width: 767px) {
  .content { padding: 12px; }
  .kpis { gap: 8px; }
  .kpi { padding: 10px; }
  .k-val { font-size: 20px; }
  .two { grid-template-columns: 1fr; gap: 0; }
}
</style>

<style>
.usage-drawer .el-drawer__body { padding: 0; }
</style>
