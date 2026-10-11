<template>
  <div class="yh-page admin">
    <div class="yh-page-header">
      <div>
        <h2 class="yh-page-title">管理</h2>
        <div class="yh-page-sub">平台只做配置：应用插拔、用户与登录、模型与 AI、系统设置</div>
      </div>
    </div>
    <div class="yh-card admin-card">
      <el-tabs v-model="tab" @tab-change="onTab">
        <el-tab-pane v-for="t in tabs" :key="t.key" :label="t.label" :name="t.key" lazy>
          <component :is="t.comp" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, markRaw, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const tabs = [
  { key: 'overview', label: '概览', comp: markRaw(defineAsyncComponent(() => import('./OverviewTab.vue'))) },
  { key: 'apps', label: '应用', comp: markRaw(defineAsyncComponent(() => import('./AppsTab.vue'))) },
  { key: 'review', label: '审核与市场', comp: markRaw(defineAsyncComponent(() => import('./ReviewTab.vue'))) },
  { key: 'users', label: '用户与部门', comp: markRaw(defineAsyncComponent(() => import('./UsersTab.vue'))) },
  { key: 'spaces', label: '空间', comp: markRaw(defineAsyncComponent(() => import('./SpacesTab.vue'))) },
  { key: 'login', label: '登录方式', comp: markRaw(defineAsyncComponent(() => import('./LoginTab.vue'))) },
  { key: 'llm', label: '模型与 AI', comp: markRaw(defineAsyncComponent(() => import('./AiTab.vue'))) },
  { key: 'kb', label: '知识库', comp: markRaw(defineAsyncComponent(() => import('./KnowledgeTab.vue'))) },
  { key: 'settings', label: '系统设置', comp: markRaw(defineAsyncComponent(() => import('./SettingsTab.vue'))) },
  { key: 'audit', label: '审计日志', comp: markRaw(defineAsyncComponent(() => import('./AuditTab.vue'))) }
]
const valid = t => (tabs.some(x => x.key === t) ? t : 'overview')
const tab = ref(valid(route.query.tab))

function onTab(t) {
  router.replace({ query: { ...route.query, tab: t } })
}
watch(() => route.query.tab, t => { tab.value = valid(t) })
</script>

<style scoped>
.admin { max-width: 1400px; }
.admin-card { padding-top: 8px; }
:deep(.el-tabs__header) { margin-bottom: 18px; }
</style>
