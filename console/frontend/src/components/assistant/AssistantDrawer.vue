<template>
  <div v-if="visible">
    <!-- 悬浮按钮 -->
    <transition name="fab">
      <button v-show="!assistant.drawerOpen" class="fab" :class="{ mobile: isMobile }" :title="assistant.status?.name || 'AI 助手'" @click="assistant.open()">
        <span class="fab-glow"></span>
        <span class="fab-icon">✦</span>
        <span v-if="!isMobile" class="fab-text">问助手</span>
      </button>
    </transition>

    <el-drawer
      :model-value="assistant.drawerOpen"
      :size="isMobile ? '100%' : 460"
      :with-header="false"
      :modal="isMobile"
      :lock-scroll="isMobile"
      modal-class="assistant-drawer-modal"
      class="assistant-drawer"
      append-to-body
      @update:model-value="v => (v ? assistant.open() : assistant.close())"
    >
      <div class="drawer-wrap">
        <div class="drawer-head">
          <div class="dh-left">
            <div class="dh-logo">✦</div>
            <div>
              <div class="dh-title">{{ assistant.status?.name || 'AI 助手' }}</div>
              <div class="dh-sub yh-ellipsis">{{ subTitle }}</div>
            </div>
          </div>
          <div class="dh-actions">
            <el-tooltip content="新对话" placement="bottom">
              <el-button text circle @click="newConversation"><el-icon><Plus /></el-icon></el-button>
            </el-tooltip>
            <el-tooltip content="全屏打开" placement="bottom">
              <el-button text circle @click="openFull"><el-icon><FullScreen /></el-icon></el-button>
            </el-tooltip>
            <el-button text circle @click="assistant.close()"><el-icon><Close /></el-icon></el-button>
          </div>
        </div>
        <div v-if="contextLabel" class="ctx-bar">
          <el-icon><Location /></el-icon> 助手知道你正在看：{{ contextLabel }}
        </div>
        <div class="drawer-body">
          <ChatPanel
            ref="chatRef"
            v-model:conversation-id="assistant.drawerConversationId"
            :get-context="getContext"
            compact
            consume-pending
            @conversation-change="onConvChange"
          />
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, FullScreen, Close, Location } from '@element-plus/icons-vue'
import ChatPanel from './ChatPanel.vue'
import { useAssistantStore } from '@/stores/assistant'
import { useUserStore } from '@/stores/user'
import { useMobile } from '@/utils/useMobile'

const route = useRoute()
const router = useRouter()
const assistant = useAssistantStore()
const user = useUserStore()
const isMobile = useMobile()
const chatRef = ref(null)
const convTitle = ref('')

// /assistant 页自己就是全屏助手，不显示抽屉
// 无助手权限（功能关闭或管理员限制）时整块不渲染
// 助手页、编辑器、轻应用这类占满全屏的页面不显示悬浮按钮（会挡住页面自己的输入框）
const visible = computed(() => !['Assistant', 'StudioApp', 'Lite', 'Onboarding'].includes(route.name) && user.permissions.assistant !== false)

const subTitle = computed(() => {
  const s = assistant.status
  if (convTitle.value) return convTitle.value
  if (!s) return '连接中…'
  if (!s.enabled) return '未启用'
  return `可调用 ${s.toolCount ?? 0} 个工具帮你办事`
})

const contextLabel = computed(() => {
  return ''
})

function getContext() {
  const ctx = { route: route.fullPath }
  return ctx
}

function onConvChange({ title }) {
  if (title) convTitle.value = title
}

function newConversation() {
  assistant.drawerConversationId = null
  convTitle.value = ''
  chatRef.value && chatRef.value.reset()
}

function openFull() {
  const id = assistant.drawerConversationId
  assistant.close()
  router.push({ path: '/assistant', query: id ? { c: id } : {} })
}
</script>

<style scoped>
.fab {
  position: fixed; right: 28px; bottom: 28px; z-index: 2000;
  display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 20px 0 16px;
  border: none; border-radius: 24px; cursor: pointer; color: var(--yh-on-primary); font-size: 14px; font-weight: 500;
  background: var(--yh-gradient);
  box-shadow: var(--yh-glow-shadow);
  transition: transform .2s, box-shadow .2s; font-family: inherit;
}
.fab:hover { transform: translateY(-2px); }
.fab-icon { font-size: 18px; position: relative; }
.fab-text { position: relative; }
.fab-glow {
  position: absolute; inset: -3px; border-radius: 28px; z-index: -1;
  background: linear-gradient(135deg, var(--yh-primary-light), var(--yh-accent-light)); opacity: .35; filter: blur(8px);
  animation: pulse 2.8s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: .2; } 50% { opacity: .5; } }
.fab.mobile {
  width: 50px; height: 50px; padding: 0; justify-content: center; right: 16px;
  bottom: calc(var(--yh-tabbar-h) + 16px + env(safe-area-inset-bottom));
}
.fab-enter-active, .fab-leave-active { transition: all .2s; }
.fab-enter-from, .fab-leave-to { opacity: 0; transform: scale(.8); }

.drawer-wrap { display: flex; flex-direction: column; height: 100%; }
.drawer-head {
  display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 12px 16px;
  border-bottom: 1px solid var(--yh-border-soft);
  background: linear-gradient(180deg, var(--yh-fill) 0%, var(--yh-card) 100%);
}
.dh-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dh-logo {
  width: 32px; height: 32px; border-radius: 9px; color: var(--yh-on-primary); display: flex; align-items: center; justify-content: center;
  background: var(--yh-gradient); flex-shrink: 0;
}
.dh-title { font-weight: 600; font-size: 15px; }
.dh-sub { font-size: 12px; color: var(--yh-text-3); max-width: 240px; }
.dh-actions { display: flex; align-items: center; }
.dh-actions .el-button + .el-button { margin-left: 0; }
.ctx-bar {
  display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--yh-ai);
  background: var(--yh-ai-soft); padding: 6px 16px;
}
.drawer-body { flex: 1; min-height: 0; }
</style>

<style>
.assistant-drawer .el-drawer__body { padding: 0; }
.assistant-drawer { box-shadow: -12px 0 40px rgba(16, 24, 40, .12) !important; }
</style>
