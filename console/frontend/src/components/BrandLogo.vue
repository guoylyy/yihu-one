<template>
  <!-- 平台 LOGO：上传了图片（空间的 > 平台的）就显示图片，否则用主题预设自带的 LOGO，再没有显示平台名称的第一个字（样式由外层 class 决定）
       reversed：放在深色底上（登录页左侧等），用预设的反白版 -->
  <img v-if="src" :src="src" :alt="app.workspaceName" class="brand-logo-img" />
  <div v-else><slot>{{ app.logoChar }}</slot></div>
</template>

<script setup>
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'

const props = defineProps({ reversed: Boolean })
const app = useAppStore()
const src = computed(() => (props.reversed ? app.logoReversed : app.logo))
</script>

<style scoped>
/* 图片 LOGO 不要底色和阴影，按比例放进同样大小的方框 */
.brand-logo-img { object-fit: contain; background: transparent !important; border: none !important; box-shadow: none !important; display: block; }
</style>
