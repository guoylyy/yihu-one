<template>
  <!-- 关于：平台名称 + 版本号（x.y.z，语义化版本；主版本为 0 时是 Beta）。版本以宿主机 yh 上报的为准（后端 upgrade.versionBrief） -->
  <el-dialog :model-value="modelValue" width="380px" class="about-dlg" align-center @update:model-value="v => emit('update:modelValue', v)">
    <div class="about">
      <BrandLogo class="about-logo" />
      <div class="about-name">{{ app.workspaceName }}</div>
      <div v-if="app.workspaceName !== '以虎 One'" class="about-product">基于 以虎 One</div>
      <div class="about-ver">
        <span class="yh-num">v{{ version }}</span>
        <span v-if="beta" class="beta">Beta</span>
      </div>
      <p v-if="beta" class="about-tip">0.x 是测试版：功能还在快速迭代，个别界面和接口可能调整。</p>
      <div class="about-links">
        <a href="/dev/releases" target="_blank" rel="noopener">版本更新说明</a>
        <span>·</span>
        <a href="/dev" target="_blank" rel="noopener">开发中心</a>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useAppStore } from '@/stores/app'
import { useUserStore } from '@/stores/user'

defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const app = useAppStore()
const user = useUserStore()
const version = computed(() => user.me?.platform?.version || '')
const beta = computed(() => user.me?.platform?.channel === 'beta')
</script>

<style scoped>
.about { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0 8px 4px; }
.about-logo {
  width: 56px; height: 56px; border-radius: 14px; background: var(--yh-primary); color: var(--yh-on-primary);
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 26px;
}
.about-name { font-size: 18px; font-weight: 700; margin-top: 14px; }
.about-product { font-size: 12px; color: var(--yh-text-3); margin-top: 2px; }
.about-ver { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 22px; font-weight: 700; }
.beta {
  font-size: 11px; font-weight: 600; letter-spacing: .5px; padding: 1px 7px; border-radius: 999px;
  color: var(--yh-highlight); border: 1px solid var(--yh-highlight); font-family: var(--yh-font-num);
}
.about-tip { font-size: 12px; color: var(--yh-text-2); margin: 10px 0 0; line-height: 1.6; }
.about-links { display: flex; gap: 8px; margin-top: 16px; font-size: 13px; color: var(--yh-text-3); }
</style>
