<template>
  <div>
    <div class="yh-muted small" style="margin-bottom: 12px">谁在用、用了多少次。轻应用里的操作、AI 助手的对话也记在这里</div>
    <el-button type="primary" plain @click="visible = true">查看使用数据</el-button>
    <AppUsageDrawer v-model="visible" :app="{ id: appId }" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import AppUsageDrawer from '@/views/admin/AppUsageDrawer.vue'

defineProps({ appId: { type: Number, required: true } })
const visible = ref(false)
</script>

<style scoped>
.small { font-size: 12px; }
</style>
