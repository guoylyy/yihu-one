<template>
  <div class="dev">
    <header class="topbar">
      <button v-if="isMobile" class="menu-btn" aria-label="文档目录" @click="navOpen = true">
        <el-icon :size="20"><Menu /></el-icon>
      </button>
      <router-link to="/dev" class="brand">
        <BrandLogo class="logo" />
        <span class="brand-text">{{ app.workspaceName }}<span class="dot">·</span>开发中心</span>
      </router-link>
      <div class="yh-grow"></div>
      <router-link to="/" class="back"><el-icon><Back /></el-icon><span>返回工作台</span></router-link>
    </header>

    <div class="body">
      <aside v-if="!isMobile" class="side">
        <DevNav />
      </aside>
      <main class="main">
        <router-view />
      </main>
    </div>

    <el-drawer v-if="isMobile" v-model="navOpen" direction="ltr" size="78%" :with-header="false" class="dev-nav-drawer">
      <DevNav @navigate="navOpen = false" />
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Menu, Back } from '@element-plus/icons-vue'
import DevNav from './DevNav.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useMobile } from '@/utils/useMobile'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const isMobile = useMobile()
const app = useAppStore()
app.load()
const navOpen = ref(false)
watch(() => route.path, () => { navOpen.value = false })
</script>

<style scoped>
.dev { min-height: 100vh; background: var(--yh-card); --dev-top: 48px; }
.topbar {
  position: sticky; top: 0; z-index: 100; height: var(--dev-top); display: flex; align-items: center; gap: 10px;
  padding: 0 20px; background: rgba(255, 255, 255, .92); backdrop-filter: saturate(180%) blur(8px);
  border-bottom: 1px solid var(--yh-border-soft);
}
.brand { display: flex; align-items: center; gap: 8px; color: var(--yh-text); font-weight: 600; font-size: 14px; min-width: 0; }
.logo { width: 26px; height: 26px; border-radius: 7px; background: var(--yh-primary); color: var(--yh-on-primary); display: inline-flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
.brand-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { color: var(--yh-text-3); margin: 0 6px; font-weight: 400; }
.back { display: inline-flex; align-items: center; gap: 4px; color: var(--yh-text-2); font-size: 13px; padding: 4px 8px; border-radius: 6px; white-space: nowrap; }
.back:hover { background: var(--yh-hover); color: var(--yh-primary); }
.menu-btn { border: none; background: none; padding: 6px; margin-left: -6px; color: var(--yh-text-2); display: inline-flex; cursor: pointer; }

.body { display: flex; max-width: 1440px; margin: 0 auto; }
.side {
  width: 248px; flex-shrink: 0; position: sticky; top: var(--dev-top); height: calc(100vh - var(--dev-top));
  overflow-y: auto; border-right: 1px solid var(--yh-border-soft); background: #fafbfc;
}
.main { flex: 1; min-width: 0; }

@media (max-width: 767px) {
  .topbar { padding: 0 12px; }
  .back span { display: none; }
}
</style>

<style>
.dev-nav-drawer .el-drawer__body { padding: 0; }
</style>
