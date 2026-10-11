<template>
  <div class="icon-picker">
    <div class="preview">
      <AppIcon :icon="icon" :name="name" :color="color" :size="48" />
      <div class="preview-actions">
        <el-button size="small" :loading="uploading" @click="upload">上传图片</el-button>
        <el-button v-if="icon" size="small" text type="danger" @click="emit('update:icon', '')">清除图标</el-button>
      </div>
    </div>

    <div class="ip-label">选择图标</div>
    <div class="icon-grid">
      <div
        v-for="n in ICON_OPTIONS"
        :key="n"
        class="ip-cell"
        :class="{ on: icon === 'svg:' + n }"
        :title="n"
        @click="emit('update:icon', 'svg:' + n)"
      >
        <component :is="ICONS[n]" />
      </div>
    </div>

    <div class="ip-label">或者填 emoji / 图片地址</div>
    <el-input :model-value="text" placeholder="如 🧾 或 https://…/logo.png" clearable @update:model-value="v => emit('update:icon', v.trim())" />

    <div class="ip-label">图标颜色</div>
    <div class="color-row">
      <span
        v-for="c in PRESET_COLORS"
        :key="c"
        class="swatch"
        :class="{ on: color === c }"
        :style="{ background: c }"
        @click="emit('update:color', c)"
      />
      <el-color-picker
        :model-value="color || PRESET_COLORS[0]"
        :predefine="PRESET_COLORS"
        @update:model-value="v => emit('update:color', v || '')"
      />
      <el-button v-if="color" size="small" text type="danger" @click="emit('update:color', '')">清除颜色</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { ICONS, ICON_OPTIONS, PRESET_COLORS } from '@/utils/icons'
import { fileToIcon } from '@/utils/image'

const props = defineProps({
  icon: { type: String, default: '' },
  name: { type: String, default: '' },
  color: { type: String, default: '' }
})
const emit = defineEmits(['update:icon', 'update:color'])

// 输入框只回显手填的内容（emoji / 图片地址），内置图标和上传的图片不往里放
const text = computed(() => (/^(svg:|data:)/.test(props.icon) ? '' : props.icon))

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
const IMAGE_MAX = 5 * 1024 * 1024
const uploading = ref(false)
function upload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = IMAGE_TYPES.join(',')
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return ElMessage.warning('只支持 PNG / JPG / GIF / WebP / SVG 图片')
    if (file.size > IMAGE_MAX) return ElMessage.warning('图片请控制在 5MB 以内')
    uploading.value = true
    try {
      emit('update:icon', await fileToIcon(file))
    } catch (e) {
      ElMessage.error(e.message || '读取图片失败')
    } finally {
      uploading.value = false
    }
  }
  input.click()
}
</script>

<style scoped>
.icon-picker { display: flex; flex-direction: column; gap: 8px; }
.preview { display: flex; align-items: center; gap: 12px; }
.preview-actions { display: flex; gap: 4px; }
.ip-label { font-size: 12px; color: var(--yh-text-3); margin-top: 4px; }
.icon-grid {
  display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px;
  max-height: 180px; overflow: auto; border: 1px solid var(--yh-border-soft); border-radius: 8px; padding: 6px;
}
.ip-cell {
  display: flex; align-items: center; justify-content: center; height: 32px; border-radius: 6px;
  cursor: pointer; color: var(--yh-text-2); transition: background .12s;
}
.ip-cell:hover { background: var(--yh-border-soft); }
.ip-cell.on { background: var(--yh-primary-soft); color: var(--yh-primary); }
.ip-cell svg { width: 18px; height: 18px; }
.color-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.swatch { width: 22px; height: 22px; border-radius: 6px; cursor: pointer; border: 2px solid transparent; }
.swatch.on { border-color: var(--yh-text); box-shadow: 0 0 0 2px #fff inset; }
</style>
