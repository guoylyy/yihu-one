<template>
  <div>
    <LlmTab />
    <div class="sep">助手设置</div>
    <SettingsTab page="ai" intro="" />
  </div>
</template>

<script setup>
import LlmTab from './LlmTab.vue'
import SettingsTab from './SettingsTab.vue'
</script>

<style scoped>
.sep { font-weight: 600; font-size: 15px; margin: 28px 0 12px; padding-top: 20px; border-top: 1px solid var(--yh-border-soft); }
</style>
