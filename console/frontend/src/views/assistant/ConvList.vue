<template>
  <div class="conv">
    <div class="conv-top">
      <el-button type="primary" class="new-btn" @click="$emit('new')"><el-icon><Plus /></el-icon>&nbsp;新对话</el-button>
    </div>
    <div class="conv-list" v-loading="loading">
      <div v-if="!list.length && !loading" class="yh-empty">还没有会话</div>
      <div
        v-for="c in list"
        :key="c.id"
        class="conv-item"
        :class="{ active: String(c.id) === String(active) }"
        @click="$emit('select', c.id)"
      >
        <el-icon class="ci-icon"><ChatDotRound /></el-icon>
        <div class="yh-grow">
          <div class="ci-title yh-ellipsis">{{ c.title || '未命名会话' }}</div>
          <div class="ci-time">{{ fromNow(c.updatedAt) }}</div>
        </div>
        <el-button class="ci-del" text circle size="small" @click.stop="$emit('remove', c)"><el-icon><Delete /></el-icon></el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Plus, ChatDotRound, Delete } from '@element-plus/icons-vue'
import { fromNow } from '@/utils/format'

defineProps({
  list: { type: Array, default: () => [] },
  active: { type: [Number, String], default: null },
  loading: { type: Boolean, default: false }
})
defineEmits(['new', 'select', 'remove'])
</script>

<style scoped>
.conv { display: flex; flex-direction: column; height: 100%; }
.conv-top { padding: 14px 12px 10px; }
.new-btn { width: 100%; border-radius: 10px; height: 38px; }
.conv-list { flex: 1; overflow-y: auto; padding: 4px 8px 12px; }
.conv-item { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 8px; cursor: pointer; }
.conv-item:hover { background: #f1f5f9; }
.conv-item.active { background: var(--yh-primary-soft); }
.conv-item.active .ci-title { color: var(--yh-primary); font-weight: 500; }
.ci-icon { color: var(--yh-text-3); flex-shrink: 0; }
.ci-title { font-size: 13.5px; }
.ci-time { font-size: 11.5px; color: var(--yh-text-3); }
.ci-del { opacity: 0; transition: opacity .15s; }
.conv-item:hover .ci-del, .conv-item.active .ci-del { opacity: 1; }
@media (hover: none) { .ci-del { opacity: 1; } }
</style>
