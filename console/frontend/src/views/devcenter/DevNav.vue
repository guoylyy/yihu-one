<template>
  <nav class="dev-nav">
    <section v-for="g in groups" :key="g.category" class="group">
      <div class="group-title">{{ g.category }}</div>
      <router-link
        v-for="d in g.items"
        :key="d.slug"
        :to="d.path"
        class="item"
        :class="{ active: currentSlug === d.slug }"
        @click="emit('navigate')"
      >{{ d.slug === 'index' ? '概览' : d.title }}</router-link>
    </section>
  </nav>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { groupedDocs } from '@/devcenter/docs'
import { useAppStore } from '@/stores/app'

const emit = defineEmits(['navigate'])
const route = useRoute()
const appCfg = useAppStore()
const currentSlug = computed(() => route.params.slug || 'index')
// 文档标题里的产品名按平台名称显示，和正文保持一致
const groups = computed(() => {
  const name = appCfg.workspaceName
  const text = s => (name && name !== '以虎 One' ? String(s ?? '').replaceAll('以虎 One', name) : s)
  return groupedDocs().map(g => ({ ...g, items: g.items.map(d => ({ ...d, title: text(d.title) })) }))
})
</script>

<style scoped>
.dev-nav { padding: 16px 12px 32px; }
.group + .group { margin-top: 18px; }
.group-title { font-size: 12px; font-weight: 600; color: var(--yh-text-3); padding: 0 10px 6px; letter-spacing: .5px; }
.item { display: block; padding: 6px 10px; border-radius: 6px; color: var(--yh-text-2); font-size: 13.5px; line-height: 1.5; }
.item:hover { background: #eef2f7; color: var(--yh-text); }
.item.active { background: var(--yh-primary-soft); color: var(--yh-primary); font-weight: 500; }
</style>
