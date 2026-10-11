<template>
  <div v-loading="loading">
    <template v-if="d">
      <div class="kpis">
        <div class="kpi" @click="go('users')"><div class="k-label">用户</div><div class="k-val">{{ d.users }}</div><div class="k-sub">近 30 天登录 {{ d.activeUsers }} 人</div></div>
        <div class="kpi" @click="go('apps')"><div class="k-label">应用</div><div class="k-val">{{ d.apps }}</div><div class="k-sub">平台托管 {{ d.managed.length }} 个</div></div>
        <div class="kpi" @click="go('llm')"><div class="k-label">可用模型</div><div class="k-val">{{ d.models }}</div><div class="k-sub">{{ d.models ? 'AI 助手可用' : '还没配置，AI 助手不可用' }}</div></div>
        <div class="kpi" :class="d.reviewPending || d.reportsOpen ? 'warn' : ''" @click="go('review')">
          <div class="k-label">应用市场</div>
          <div class="k-val small-val">{{ d.reviewPending }} 待审核</div>
          <div class="k-sub">{{ d.reportsOpen ? `${d.reportsOpen} 条举报待处理` : '没有待处理的举报' }}</div>
        </div>
        <div class="kpi" :class="d.platform.agent.online ? 'ok' : 'warn'" @click="go('apps')">
          <div class="k-label">yh agent</div>
          <div class="k-val small-val">{{ d.platform.agent.online ? '在线' : '未连接' }}</div>
          <div class="k-sub">{{ d.platform.agent.lastSeenAt ? `最近上报 ${fromNow(d.platform.agent.lastSeenAt)}` : '宿主机上运行 yh agent 后可在这里插拔应用' }}</div>
        </div>
      </div>

      <PlatformVersion :platform="d.platform" @changed="refresh" />
      <div class="grid">
        <section class="box">
          <div class="box-title">托管应用</div>
          <div v-if="!d.managed.length" class="yh-empty small">还没有。到「应用」页从 Git 安装，或在宿主机上 <code>yh new / yh add</code></div>
          <div v-for="a in d.managed" :key="a.code" class="row">
            <AppIcon :icon="a.icon" :name="a.name" :color="a.iconColor" :size="24" />
            <span class="yh-grow yh-ellipsis">{{ a.name }} <span class="yh-muted small">{{ a.code }}</span></span>
            <span class="dot" :class="a.status !== 'ACTIVE' ? 'off' : a.healthy ? 'ok' : 'bad'"></span>
            <span class="small" :class="{ 'yh-muted': a.status !== 'ACTIVE' }">{{ a.status !== 'ACTIVE' ? '已停用' : a.healthy ? '正常' : a.runtime ? '异常' : '未上报' }}</span>
            <span v-if="a.runtime?.version" class="ver">{{ a.runtime.version }}</span>
          </div>
        </section>

        <section class="box">
          <div class="box-title">最近发布</div>
          <div v-if="!d.recentDeploys.length" class="yh-empty small">暂无发布记录</div>
          <div v-for="r in d.recentDeploys" :key="r.id" class="row">
            <el-tag size="small" :type="DEPLOY_RESULT[r.result] || 'info'">{{ r.result }}</el-tag>
            <span class="yh-grow yh-ellipsis" :title="r.subject"><b>{{ r.appCode === 'platform' ? '平台' : r.appCode }}</b> <code>{{ r.version }}</code> {{ r.subject }}</span>
            <span class="yh-muted small">{{ fromNow(r.createdAt) }}</span>
          </div>
        </section>

        <section class="box">
          <div class="box-title">最近操作</div>
          <div v-if="!d.recentOps.length" class="yh-empty small">暂无</div>
          <div v-for="o in d.recentOps" :key="o.id" class="row">
            <el-tag size="small" :type="OP_STATUS[o.status]?.type">{{ OP_STATUS[o.status]?.label }}</el-tag>
            <span class="yh-grow yh-ellipsis">{{ OP_KIND[o.kind] }} <b v-if="o.appCode !== 'platform'">{{ o.appCode }}</b><span class="yh-muted"> · {{ o.requestedBy?.name || '系统' }}</span></span>
            <span class="yh-muted small">{{ fromNow(o.createdAt) }}</span>
          </div>
        </section>

        <section class="box">
          <div class="box-title">近 30 天使用 <span class="yh-muted small">点击看详情</span></div>
          <div v-if="!d.topApps.length" class="yh-empty small">还没有使用数据</div>
          <div v-for="a in d.topApps" :key="a.id" class="row click" @click="openUsage(a)">
            <AppIcon :icon="a.icon" :name="a.name" :color="a.iconColor" :size="24" />
            <span class="yh-grow yh-ellipsis">{{ a.name }}</span>
            <span class="small"><b>{{ a.users }}</b> 人</span>
            <span class="yh-muted small">打开 {{ a.workbenchEvents }} 次</span>
            <span v-if="a.appEvents" class="small ok-text">上报 {{ a.appEvents }}</span>
          </div>
        </section>
      </div>
    </template>
    <AppUsageDrawer v-model="usage.visible" :app="usage.app" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import AppUsageDrawer from './AppUsageDrawer.vue'
import PlatformVersion from './PlatformVersion.vue'
import { adminApi } from '@/api/admin'
import { OP_KIND, OP_STATUS, DEPLOY_RESULT } from '@/utils/constants'
import { fromNow } from '@/utils/format'

const router = useRouter()
const route = useRoute()
const d = ref(null)
const loading = ref(false)
const usage = reactive({ visible: false, app: null })

const go = tab => router.replace({ query: { ...route.query, tab } })
function openUsage(a) { usage.app = a; usage.visible = true }

// 升级、检查更新之后静默重新取一次（不闪 loading，也不打断正在显示的升级进度）
async function refresh() {
  const next = await adminApi.overview().catch(() => null)
  if (next) d.value = next
}

onMounted(async () => {
  loading.value = true
  try { d.value = await adminApi.overview() } finally { loading.value = false }
})
</script>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.kpi { border: 1px solid var(--yh-border-soft); border-radius: 12px; padding: 14px 16px; cursor: pointer; transition: border-color .15s; background: var(--yh-card); }
.kpi:hover { border-color: var(--el-color-primary-light-7); }
.kpi.ok { background: #f0fdf4; border-color: #dcfce7; }
.kpi.warn { background: #fffbeb; border-color: #fef3c7; }
.k-label { font-size: 12px; color: var(--yh-text-3); }
.k-val { font-size: 26px; font-weight: 600; margin: 4px 0 2px; }
.k-val.small-val { font-size: 20px; }
.k-sub { font-size: 12px; color: var(--yh-text-2); }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.box { border: 1px solid var(--yh-border-soft); border-radius: 12px; padding: 12px 14px; }
.box-title { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
.row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; font-size: 13px; border-radius: 6px; }
.row.click { cursor: pointer; }
.row.click:hover { background: var(--yh-fill); }
.row code { font-size: 12px; color: var(--yh-text-2); }
.small { font-size: 12px; }
.ok-text { color: var(--yh-success); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: #cbd5e1; }
.dot.ok { background: var(--yh-success); }
.dot.bad { background: var(--yh-danger); }
.ver { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--yh-text-3); background: var(--yh-fill-2); padding: 0 5px; border-radius: 4px; }
@media (max-width: 900px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid { grid-template-columns: 1fr; }
}
</style>
