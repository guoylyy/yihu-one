<template>
  <el-form-item v-if="field" :label="field.label">
    <el-input
      v-if="field.type === 'password'"
      :model-value="modelValue"
      type="password"
      show-password
      autocomplete="new-password"
      :placeholder="field.value ? '已设置，留空不修改' : '未设置'"
      @update:model-value="$emit('update:modelValue', $event)"
    />
    <el-select
      v-else-if="field.type === 'list'"
      :model-value="modelValue"
      multiple
      filterable
      allow-create
      default-first-option
      :reserve-keyword="false"
      placeholder="输入后回车，可填多个"
      style="width: 100%"
      @update:model-value="$emit('update:modelValue', $event)"
    />
    <el-switch v-else-if="field.type === 'bool'" :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" />
    <el-input v-else :model-value="modelValue" :placeholder="placeholder" clearable @update:model-value="$emit('update:modelValue', $event)" />
    <div v-if="help !== false && (help || field.help)" class="f-help">{{ help || field.help }}</div>
  </el-form-item>
</template>

<script setup>
// 开通向导里按系统设置的定义渲染一个输入项（文字 / 密码 / 列表 / 开关）
defineProps({
  field: { type: Object, default: null },
  modelValue: { type: [String, Number, Boolean, Array], default: '' },
  /** 覆盖设置里的说明；false 不显示 */
  help: { type: [String, Boolean], default: '' },
  placeholder: { type: String, default: '' }
})
defineEmits(['update:modelValue'])
</script>

<style scoped>
.f-help { font-size: 12px; color: var(--yh-text-3); line-height: 1.6; margin-top: 4px; width: 100%; }
</style>
