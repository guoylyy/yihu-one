<template>
  <el-select
    :model-value="modelValue"
    :multiple="multiple"
    filterable
    remote
    clearable
    reserve-keyword
    :remote-method="search"
    :loading="loading"
    :placeholder="placeholder"
    :disabled="disabled"
    style="width: 100%"
    @update:model-value="onChange"
    @visible-change="onVisible"
  >
    <el-option v-for="e in options" :key="e.id" :label="e.name" :value="e.id">
      <div class="user-opt">
        <UserAvatar :user="e" :size="22" />
        <span class="name">{{ e.name }}</span>
        <span class="meta">{{ metaText(e) }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<script setup>
import { ref, watch } from 'vue'
import { orgApi } from '@/api/org'
import UserAvatar from './UserAvatar.vue'

const props = defineProps({
  modelValue: { type: [Number, String, Array], default: null },
  multiple: { type: Boolean, default: false },
  placeholder: { type: String, default: '输入姓名搜索' },
  disabled: { type: Boolean, default: false },
  // 已选人员的展示信息（EmpBrief[]），避免回显时只显示 id
  initial: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'change'])

const options = ref([])
const loading = ref(false)
let seq = 0

function mergeOptions(list) {
  const map = new Map(options.value.map(o => [o.id, o]))
  list.forEach(o => map.set(o.id, { ...map.get(o.id), ...o }))
  options.value = [...map.values()]
}

watch(() => props.initial, v => { if (v && v.length) mergeOptions(v.filter(Boolean)) }, { immediate: true })

function metaText(e) {
  const dept = (e.depts || []).find(d => d.isPrimary) || (e.depts || [])[0]
  return [dept?.name, e.title].filter(Boolean).join(' · ')
}

async function search(keyword) {
  const my = ++seq
  loading.value = true
  try {
    const res = await orgApi.users({ keyword, pageSize: 30 })
    if (my !== seq) return
    const selected = new Set([].concat(props.modelValue ?? []))
    const keep = options.value.filter(o => selected.has(o.id))
    options.value = keep
    mergeOptions(res?.list || [])
  } catch {
    /* 已提示 */
  } finally {
    if (my === seq) loading.value = false
  }
}

function onVisible(v) {
  if (v && options.value.length <= [].concat(props.modelValue ?? []).length) search('')
}

function onChange(v) {
  emit('update:modelValue', v)
  const pick = Array.isArray(v) ? options.value.filter(o => v.includes(o.id)) : options.value.find(o => o.id === v) || null
  emit('change', v, pick)
}
</script>

<style scoped>
.user-opt { display: flex; align-items: center; gap: 8px; }
.user-opt .name { font-weight: 500; }
.user-opt .meta { color: #9ca3af; font-size: 12px; margin-left: auto; padding-left: 12px; }
</style>
