<template>
  <!-- 一张卡片出错只影响它自己，首页其余部分照常显示 -->
  <section v-if="error" class="yh-card card-error">
    <div class="yh-card-title">{{ title || '卡片' }}</div>
    <div class="yh-muted small">这张卡片显示不出来：{{ error }}</div>
  </section>
  <slot v-else />
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue'

defineProps({ title: { type: String, default: '' } })
const error = ref('')
onErrorCaptured((e) => {
  error.value = e?.message || String(e)
  return false
})
</script>

<style scoped>
.card-error { border: 1px dashed var(--el-color-danger-light-5); }
.small { font-size: 12px; margin-top: 6px; }
</style>
