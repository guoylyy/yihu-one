<template>
  <div class="card" @click="$router.push(`/market/${app.id}`)">
    <div class="top">
      <AppIcon :icon="app.icon" :name="app.name" :color="app.iconColor" :size="46" />
      <div class="yh-grow" style="min-width: 0">
        <div class="name">
          <span class="yh-ellipsis">{{ app.name }}</span>
          <span class="kind" :style="{ color: kindMeta.color, borderColor: kindMeta.color + '40' }">{{ kindMeta.label }}</span>
        </div>
        <div class="meta yh-ellipsis">
          <template v-if="app.publisher">{{ app.publisher.name }}</template>
          <template v-if="app.scope !== 'MARKET'"> · {{ APP_SCOPE[app.scope]?.label }}</template>
        </div>
      </div>
    </div>
    <div class="desc">{{ app.description || '暂无简介' }}</div>
    <div class="foot" @click.stop>
      <div class="stats">
        <span v-if="app.rating" class="stars">★ {{ app.rating }}</span>
        <span>{{ app.installs }} 人在用</span>
        <span v-if="app.hasMcp" class="yh-tag-ai" title="AI 助手可以调用它的能力">✦ AI</span>
      </div>
      <el-button v-if="app.installed" size="small" @click="$emit('toggle', app)"><el-icon><Check /></el-icon>&nbsp;已添加</el-button>
      <el-button v-else size="small" type="primary" plain @click="$emit('toggle', app)"><el-icon><Plus /></el-icon>&nbsp;添加</el-button>
      <el-button size="small" text @click="openApp(app, $router)">打开</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Plus, Check } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import { APP_KIND, APP_SCOPE } from '@/utils/constants'
import { openApp } from '@/utils/navigate'

const props = defineProps({ app: { type: Object, required: true } })
defineEmits(['toggle'])
const kindMeta = computed(() => APP_KIND[props.app.kind] || { label: props.app.kind, color: '#64748b' })
</script>

<style scoped>
.card {
  background: var(--yh-card); border: 1px solid var(--yh-border-soft); border-radius: 12px; padding: 16px; cursor: pointer;
  box-shadow: var(--yh-shadow); transition: all .15s; display: flex; flex-direction: column;
}
.card:hover { border-color: var(--el-color-primary-light-7); box-shadow: 0 6px 16px rgba(var(--yh-primary-rgb), .08); }
.top { display: flex; gap: 12px; align-items: center; }
.name { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 15px; min-width: 0; }
.kind { font-size: 11px; font-weight: 500; border: 1px solid; border-radius: 4px; padding: 0 5px; line-height: 17px; flex-shrink: 0; }
.meta { font-size: 12px; color: var(--yh-text-3); margin-top: 2px; }
.desc { color: var(--yh-text-2); font-size: 13px; margin: 12px 0; line-height: 1.6; flex: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 42px; }
.foot { display: flex; align-items: center; gap: 6px; }
.stats { flex: 1; display: flex; gap: 10px; font-size: 12px; color: var(--yh-text-3); align-items: center; min-width: 0; }
.stars { color: #f59e0b; font-weight: 500; }
</style>
