<template>
  <div class="json-input" :class="{ err: !!error }">
    <el-input
      :model-value="modelValue"
      type="textarea"
      :autosize="{ minRows: rows, maxRows: 16 }"
      :placeholder="placeholder"
      spellcheck="false"
      @update:model-value="v => emit('update:modelValue', v)"
      @blur="e => onBlur(e)"
    />
    <div v-if="error" class="err-text">{{ error }}</div>
  </div>
</template>

<script setup>
import { prettyJson } from '@/utils/json'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  error: { type: String, default: '' },
  rows: { type: Number, default: 3 }
})
const emit = defineEmits(['update:modelValue'])

// 失焦时若是合法 JSON 就顺手格式化
function onBlur(e) {
  const t = ((e && e.target && e.target.value) ?? props.modelValue ?? '').trim()
  if (!t) return
  try {
    emit('update:modelValue', prettyJson(JSON.parse(t)))
  } catch { /* 保留原文，保存时再报错 */ }
}
</script>

<style scoped>
.json-input { width: 100%; }
.json-input :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.5; }
.json-input.err :deep(.el-textarea__inner) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.err-text { color: var(--yh-danger); font-size: 12px; margin-top: 2px; line-height: 1.4; }
</style>
