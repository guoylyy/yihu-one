<template>
  <div class="app-icon" :style="boxStyle">
    <img v-if="isImg" :src="icon" alt="" />
    <component :is="SvgIcon" v-else-if="SvgIcon" class="svg" :style="{ color: fg, fontSize: size * 0.5 + 'px' }" />
    <span v-else-if="isEmoji" class="emoji" :style="{ fontSize: size * 0.52 + 'px' }">{{ icon }}</span>
    <span v-else class="letter" :style="{ color: fg, fontSize: size * 0.42 + 'px' }">{{ (name || '?').slice(0, 1) }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { isImageIcon } from '@/utils/format'
import { ICONS } from '@/utils/icons'
import { tint } from '@/utils/color'

const props = defineProps({
  icon: { type: String, default: '' },
  name: { type: String, default: '' },
  color: { type: String, default: '' },
  size: { type: Number, default: 44 }
})

const isImg = computed(() => isImageIcon(props.icon))
const svgName = computed(() => (props.icon && props.icon.startsWith('svg:') ? props.icon.slice(4) : ''))
const SvgIcon = computed(() => ICONS[svgName.value] || null)
const isEmoji = computed(() => !!props.icon && !isImg.value && !svgName.value)

const palette = ['#eff6ff', '#f0fdf4', '#fef3c7', '#fce7f3', '#ede9fe', '#ecfeff', '#fff7ed']
const seed = computed(() => (props.name || props.icon || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0))
const fg = computed(() => props.color || 'var(--yh-primary)')
const boxStyle = computed(() => {
  const bg = isImg.value ? 'transparent' : (props.color ? tint(props.color, 0.88) : palette[seed.value % palette.length])
  return {
    width: props.size + 'px',
    height: props.size + 'px',
    borderRadius: Math.round(props.size * 0.26) + 'px',
    background: bg
  }
})
</script>

<style scoped>
.app-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; }
.app-icon img { width: 100%; height: 100%; object-fit: cover; }
.emoji { line-height: 1; }
.svg { line-height: 1; }
.letter { font-weight: 600; }
</style>
