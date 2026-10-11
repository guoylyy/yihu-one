<template>
  <div class="layout" :class="{ mobile: isMobile }">
    <!-- 桌面侧边栏 -->
    <aside v-if="!isMobile" class="sidebar">
      <div class="brand" @click="$router.push('/')">
        <BrandLogo class="brand-logo" />
        <div>
          <div class="brand-name">{{ app.workspaceName }}</div>
          <div v-if="app.workspaceSubtitle" class="brand-sub">{{ app.workspaceSubtitle }}</div>
        </div>
      </div>
      <nav class="nav">
        <router-link v-for="n in navItems" :key="n.key" :to="n.to" class="nav-item" :class="{ active: activeNav === n.key, ai: n.key === 'assistant' }">
          <el-icon class="nav-icon"><component :is="n.icon" /></el-icon>
          <span class="nav-label">{{ n.label }}</span>
          <span v-if="n.key === 'assistant'" class="nav-ai-dot">AI</span>
        </router-link>
      </nav>
      <div class="sidebar-foot">
        <a href="/dev" target="_blank" rel="noopener" class="nav-item" title="应用接入文档（新标签打开）">
          <el-icon class="nav-icon"><Reading /></el-icon><span class="nav-label">开发中心</span>
          <el-icon class="ext"><TopRight /></el-icon>
        </a>
        <router-link to="/me" class="nav-item" :class="{ active: activeNav === 'me' }">
          <el-icon class="nav-icon"><User /></el-icon><span class="nav-label">个人中心</span>
        </router-link>
        <button v-if="version" type="button" class="ver-line" title="关于 / 版本" @click="aboutOpen = true">
          <span class="yh-num">v{{ version }}</span><span v-if="beta" class="ver-beta">Beta</span>
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="header">
        <template v-if="isMobile">
          <el-button text class="menu-btn" @click="menuOpen = true"><el-icon :size="20"><Menu /></el-icon></el-button>
          <div class="m-title">{{ route.meta.title || app.workspaceName }}</div>
        </template>
        <div v-else class="h-title">{{ route.meta.title }}</div>

        <el-dropdown trigger="click" @command="onCommand">
          <div class="user-box">
            <UserAvatar :user="user.me" :size="isMobile ? 30 : 32" />
            <div v-if="!isMobile" class="user-text">
              <div class="user-name">{{ user.me?.name }}</div>
              <div class="user-dept yh-ellipsis">{{ deptText }}</div>
            </div>
            <el-icon v-if="!isMobile" class="yh-muted"><ArrowDown /></el-icon>
          </div>
          <template #dropdown>
            <el-dropdown-menu>
              <div class="dd-user">
                <div class="dd-name">{{ user.me?.name }}</div>
                <div class="dd-dept">{{ deptText }}</div>
              </div>
              <el-dropdown-item command="me" :icon="User">个人中心</el-dropdown-item>
              <el-dropdown-item command="about" :icon="InfoFilled">关于{{ version ? ` · v${version}` : '' }}</el-dropdown-item>
              <el-dropdown-item command="logout" :icon="SwitchButton" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <main class="content" :class="{ 'full-height': route.meta.fullHeight }">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </div>

    <!-- 移动端底部 tab -->
    <nav v-if="isMobile && !route.meta.fullHeight" class="tabbar">
      <router-link v-for="t in tabItems" :key="t.key" :to="t.to" class="tab" :class="{ active: activeNav === t.key }">
        <span class="tab-icon-wrap">
          <el-icon :size="21"><component :is="t.icon" /></el-icon>
        </span>
        <span class="tab-label">{{ t.label }}</span>
      </router-link>
    </nav>

    <!-- 移动端导航抽屉 -->
    <el-drawer v-if="isMobile" v-model="menuOpen" direction="ltr" size="72%" :with-header="false" class="m-menu">
      <div class="m-menu-user">
        <UserAvatar :user="user.me" :size="44" />
        <div>
          <div class="user-name">{{ user.me?.name }}</div>
          <div class="user-dept">{{ deptText }}</div>
        </div>
      </div>
      <nav class="nav">
        <router-link v-for="n in [...navItems, { key: 'me', label: '个人中心', to: '/me', icon: User }]" :key="n.key" :to="n.to" class="nav-item" :class="{ active: activeNav === n.key }" @click="menuOpen = false">
          <el-icon class="nav-icon"><component :is="n.icon" /></el-icon>
          <span class="nav-label">{{ n.label }}</span>
        </router-link>
      </nav>
      <nav class="nav m-extra">
        <a href="/dev" target="_blank" rel="noopener" class="nav-item">
          <el-icon class="nav-icon"><Reading /></el-icon><span class="nav-label">开发中心</span><el-icon class="ext"><TopRight /></el-icon>
        </a>
      </nav>
      <div class="m-menu-foot">
        <el-button plain style="width: 100%" @click="logout">退出登录</el-button>
        <button v-if="version" type="button" class="ver-line" @click="aboutOpen = true; menuOpen = false">
          <span class="yh-num">v{{ version }}</span><span v-if="beta" class="ver-beta">Beta</span>
        </button>
      </div>
    </el-drawer>

    <AssistantDrawer />
    <AboutDialog v-model="aboutOpen" />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import {
  HomeFilled, Grid, Files, MagicStick, Setting, User, Menu, ArrowDown, SwitchButton, Reading, TopRight, EditPen, InfoFilled
} from '@element-plus/icons-vue'
import UserAvatar from '@/components/UserAvatar.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import AssistantDrawer from '@/components/assistant/AssistantDrawer.vue'
import AboutDialog from '@/components/AboutDialog.vue'
import { useUserStore } from '@/stores/user'
import { useAssistantStore } from '@/stores/assistant'
import { useAppStore } from '@/stores/app'
import { useMobile } from '@/utils/useMobile'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const assistant = useAssistantStore()
const app = useAppStore()
const isMobile = useMobile()
const menuOpen = ref(false)
const aboutOpen = ref(false)
// 平台版本（x.y.z）：所有人都能看到，0.x 标 Beta
const version = computed(() => user.me?.platform?.version || '')
const beta = computed(() => user.me?.platform?.channel === 'beta')

const navItems = computed(() => {
  const items = [
    { key: 'home', label: '工作台', to: '/', icon: markRaw(HomeFilled) },
    { key: 'market', label: '应用市场', to: '/market', icon: markRaw(Grid) },
    { key: 'assets', label: '资料', to: '/assets', icon: markRaw(Files) },
    { key: 'assistant', label: app.features.assistantName || 'AI 助手', to: '/assistant', icon: markRaw(MagicStick) },
    { key: 'studio', label: '创作中心', to: '/studio', icon: markRaw(EditPen) }
  ].filter(i => i.key !== 'assistant' || user.permissions.assistant !== false)
  if (user.permissions.admin) items.push({ key: 'admin', label: '管理', to: '/admin', icon: markRaw(Setting) })
  return items
})

const tabItems = computed(() => {
  const items = [
    { key: 'home', label: '工作台', to: '/', icon: markRaw(HomeFilled) },
    { key: 'assistant', label: '助手', to: '/assistant', icon: markRaw(MagicStick) },
    { key: 'market', label: '市场', to: '/market', icon: markRaw(Grid) }
  ].filter(i => i.key !== 'assistant' || user.permissions.assistant !== false)
  if (user.permissions.admin) items.push({ key: 'admin', label: '管理', to: '/admin', icon: markRaw(Setting) })
  items.push({ key: 'me', label: '我的', to: '/me', icon: markRaw(User) })
  return items
})

const activeNav = computed(() => route.meta.nav || '')
const deptText = computed(() => {
  const me = user.me
  if (!me) return ''
  return [user.primaryDept?.name, me.title].filter(Boolean).join(' · ')
})

onMounted(() => {
  app.load()
  if (user.permissions.assistant !== false) assistant.loadStatus()
})

function onCommand(cmd) {
  if (cmd === 'me') router.push('/me')
  if (cmd === 'about') aboutOpen.value = true
  if (cmd === 'logout') logout()
}

async function logout() {
  try {
    await ElMessageBox.confirm('确定退出登录吗？', '退出', { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' })
  } catch {
    return
  }
  menuOpen.value = false
  assistant.$reset()
  user.logout()
  router.replace('/login')
}

</script>

<style scoped>
.layout { display: flex; min-height: 100vh; }

/* 侧边栏 */
.sidebar {
  width: var(--yh-sidebar-w); flex-shrink: 0; background: var(--yh-sidebar); border-right: 1px solid var(--yh-border);
  display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 18px 18px 20px; cursor: pointer; }
.brand-logo {
  width: 36px; height: 36px; border-radius: 10px; background: var(--yh-primary); color: var(--yh-on-primary); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;
  box-shadow: var(--yh-shadow);
}
.brand > div:last-child { min-width: 0; }
.brand-name { font-weight: 700; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.brand-sub { font-size: 9.5px; letter-spacing: 1.2px; color: var(--yh-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nav { padding: 4px 12px; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px;
  color: var(--yh-text-2); font-size: 14px; transition: all .15s; position: relative;
}
.nav-item:hover { background: var(--yh-hover); color: var(--yh-text); }
.nav-item.active { background: var(--yh-nav-active-bg); color: var(--yh-nav-active-color); font-weight: 500; }
.nav-item.active .nav-icon { color: var(--yh-nav-tick); }
.nav-icon { font-size: 17px; }
.nav-label { flex: 1; }
.nav-badge {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--yh-danger); color: #fff;
  font-size: 11px; display: inline-flex; align-items: center; justify-content: center; line-height: 1;
}
.nav-ai-dot {
  font-size: 10px; font-weight: 600; padding: 0 5px; border-radius: 4px; line-height: 16px; color: var(--yh-on-primary);
  background: var(--yh-gradient);
}
.sidebar-foot { padding: 12px; border-top: 1px solid var(--yh-border-soft); display: flex; flex-direction: column; gap: 2px; }
.ext { font-size: 12px; color: var(--yh-text-3); }
.ver-line {
  display: flex; align-items: center; gap: 6px; margin: 6px 12px 0; padding: 0; border: none; background: none; cursor: pointer;
  font-size: 11.5px; color: var(--yh-text-3); font-family: inherit;
}
.ver-line:hover { color: var(--yh-text-2); }
.ver-beta { font-size: 10px; font-weight: 600; padding: 0 5px; line-height: 15px; border-radius: 999px; color: var(--yh-highlight); border: 1px solid currentColor; }
.m-menu-foot .ver-line { margin: 12px auto 0; }
.m-extra { flex: 0; border-top: 1px solid var(--yh-border-soft); padding-top: 8px; }

/* 主区 */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.header {
  height: var(--yh-header-h); display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; background: rgba(var(--yh-card-rgb), .88); backdrop-filter: saturate(180%) blur(8px);
  border-bottom: 1px solid var(--yh-border-soft); position: sticky; top: 0; z-index: 100;
}
.h-title { font-size: 15px; font-weight: 500; color: var(--yh-text-2); }
.user-box { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 4px 8px; border-radius: 8px; outline: none; }
.user-box:hover { background: var(--yh-hover); }
.user-text { line-height: 1.3; max-width: 200px; }
.user-name { font-weight: 500; font-size: 14px; }
.user-dept { font-size: 12px; color: var(--yh-text-3); }
.dd-user { padding: 8px 16px 10px; border-bottom: 1px solid var(--yh-border-soft); margin-bottom: 4px; min-width: 160px; }
.dd-name { font-weight: 600; }
.dd-dept { font-size: 12px; color: var(--yh-text-3); }

.content { flex: 1; min-height: 0; }
.content.full-height { height: calc(100vh - var(--yh-header-h)); overflow: hidden; }

/* 移动端 */
.mobile .header { padding: 0 8px 0 4px; height: 50px; }
.mobile .content { padding-bottom: calc(var(--yh-tabbar-h) + env(safe-area-inset-bottom)); }
.mobile .content.full-height { height: calc(100vh - 50px); height: calc(100dvh - 50px); padding-bottom: 0; }
.menu-btn { padding: 8px; }
.m-title { flex: 1; font-weight: 600; font-size: 16px; }
.tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000; display: flex;
  height: calc(var(--yh-tabbar-h) + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom);
  background: rgba(var(--yh-card-rgb), .96); backdrop-filter: blur(8px); border-top: 1px solid var(--yh-border);
}
.tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--yh-text-3); font-size: 11px; }
.tab.active { color: var(--yh-primary); }
.tab.active .tab-icon-wrap { color: var(--yh-highlight); }
.tab-icon-wrap { position: relative; display: inline-flex; }
.tab-badge {
  position: absolute; top: -5px; left: 14px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: var(--yh-danger); color: #fff; font-size: 10px; line-height: 16px; text-align: center;
}
.m-menu-user { display: flex; align-items: center; gap: 12px; padding: 20px 16px 16px; border-bottom: 1px solid var(--yh-border-soft); margin-bottom: 8px; }
.m-menu-foot { padding: 16px; }
</style>

<style>
.m-menu .el-drawer__body { padding: 0; display: flex; flex-direction: column; }
</style>
