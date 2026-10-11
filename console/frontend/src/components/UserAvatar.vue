<template>
  <el-avatar :size="size" :src="user?.avatar || undefined" :style="{ background: bg, flexShrink: 0 }" class="user-avatar">
    <span :style="{ fontSize: size * 0.4 + 'px' }">{{ initial }}</span>
  </el-avatar>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  user: { type: Object, default: null },
  size: { type: Number, default: 28 }
})

// 跟着主题（VI）走：主色、次要文字色、主色浅一档轮流用，不另起一套颜色
const colors = ['var(--yh-primary)', 'var(--yh-text-2)', 'var(--yh-primary-light)']
const initial = computed(() => {
  const n = props.user?.name || '?'
  return n.length > 2 ? n.slice(-2) : n
})
const bg = computed(() => {
  const n = props.user?.name || ''
  const s = n.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return colors[s % colors.length]
})
</script>

<style scoped>
.user-avatar { color: var(--yh-on-primary); font-weight: 500; }
</style>
