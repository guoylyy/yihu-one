<template>
  <div class="assistant-page">
    <aside v-if="!isMobile" class="conv-side">
      <ConvList
        :list="shownConversations"
        :active="currentId"
        :loading="loadingList"
        @new="newConversation"
        @select="select"
        @remove="remove"
      />
    </aside>

    <section class="chat-area">
      <div class="chat-head">
        <el-button v-if="isMobile" text circle @click="listOpen = true"><el-icon :size="18"><Fold /></el-icon></el-button>
        <!-- 切换助手：默认助手 + 工作台上装的 AI 助手 -->
        <el-dropdown trigger="click" @command="switchAgent">
          <div class="picker">
            <AppIcon v-if="currentAgent" :icon="currentAgent.icon || '✦'" :name="currentAgent.name" :color="currentAgent.iconColor" :size="22" />
            <span v-else class="p-icon">✦</span>
            <span class="p-name yh-ellipsis">{{ currentAgent?.name || assistant.status?.name || 'AI 助手' }}</span>
            <el-icon class="yh-muted"><ArrowDown /></el-icon>
          </div>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="" :class="{ on: !appId }">✦ {{ assistant.status?.name || 'AI 助手' }}（默认）</el-dropdown-item>
              <el-dropdown-item v-for="a in agents" :key="a.id" :command="String(a.id)" :class="{ on: String(appId) === String(a.id) }">
                <AppIcon :icon="a.icon || '✦'" :name="a.name" :color="a.iconColor" :size="20" style="margin-right: 6px" />{{ a.name }}
              </el-dropdown-item>
              <el-dropdown-item command="market" divided>去市场找更多 AI 助手…</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <div class="ch-title yh-ellipsis yh-muted">{{ currentId ? currentTitle : '' }}</div>
        <div class="ch-meta">
          <template v-if="assistant.status?.enabled">
            <span class="dot-on"></span>
            <span class="yh-muted">{{ agentStatus ? agentStatus.toolCount : assistant.status.toolCount ?? 0 }} 个工具</span>
          </template>
          <el-button v-if="!appId" text size="small" title="我的助手用哪些应用" @click="openToolPrefs"><el-icon><Setting /></el-icon></el-button>
        </div>
        <el-button v-if="isMobile" text circle @click="newConversation"><el-icon :size="18"><Plus /></el-icon></el-button>
      </div>
      <div class="chat-body">
        <ChatPanel
          ref="chatRef"
          :key="appId || 'default'"
          v-model:conversation-id="currentId"
          :conversation-model-id="currentModelId"
          :get-context="getContext"
          :agent="currentAgent"
          :app-id="appId"
          @conversation-change="onConvChange"
        />
      </div>
    </section>

    <el-drawer v-if="isMobile" v-model="listOpen" direction="ltr" size="80%" :with-header="false" class="conv-drawer">
      <ConvList
        :list="shownConversations"
        :active="currentId"
        :loading="loadingList"
        @new="newConversation(); listOpen = false"
        @select="id => { select(id); listOpen = false }"
        @remove="remove"
      />
    </el-drawer>

    <el-dialog v-model="prefs.visible" title="我的助手用哪些应用" width="460px">
      <div class="yh-muted small" style="margin-bottom: 12px">默认助手会用到你能看到的应用提供的工具。关掉不常用的，助手回答更快、更少走偏。</div>
      <div v-loading="prefs.loading">
        <div v-if="!prefs.list.length && !prefs.loading" class="yh-muted small">你能看到的应用里还没有提供 AI 工具的</div>
        <div v-for="a in prefs.list" :key="a.code" class="pref-row">
          <AppIcon :icon="a.icon" :name="a.name" :color="a.iconColor" :size="26" />
          <span class="yh-grow">{{ a.name }}</span>
          <el-switch v-model="a.enabled" />
        </div>
      </div>
      <template #footer>
        <el-button @click="prefs.visible = false">取消</el-button>
        <el-button type="primary" :loading="prefs.saving" @click="saveToolPrefs">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Fold, Plus, ArrowDown, Setting } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import { appApi } from '@/api/apps'
import { meApi } from '@/api/me'
import ChatPanel from '@/components/assistant/ChatPanel.vue'
import ConvList from './ConvList.vue'
import { assistantApi } from '@/api/assistant'
import { useAssistantStore } from '@/stores/assistant'
import { useMobile } from '@/utils/useMobile'

const route = useRoute()
const router = useRouter()
const assistant = useAssistantStore()
const isMobile = useMobile()

const conversations = ref([])
const loadingList = ref(false)
const currentId = ref(route.query.c ? Number(route.query.c) || route.query.c : null)
// 当前用哪个助手：?app=<id>，空 = 默认助手
const appId = ref(route.query.app ? Number(route.query.app) : null)
const agents = ref([])
const agentStatus = ref(null)
const currentAgent = computed(() => agentStatus.value?.agent || null)
// 只列当前助手的会话；创作中心里的试聊不出现在这里
const shownConversations = computed(() => conversations.value.filter(c => (c.appId || null) === (appId.value || null) && !c.versionId))

async function loadAgent() {
  agentStatus.value = appId.value ? await assistantApi.status(appId.value).catch(() => null) : null
  if (appId.value && !agentStatus.value?.agent) ElMessage.warning('这个 AI 助手不可用（可能已下架或没分享给你），已切回默认助手')
  if (appId.value && !agentStatus.value?.agent) appId.value = null
}
async function loadAgents() {
  agents.value = ((await appApi.list().catch(() => [])) || []).filter(a => a.kind === 'AGENT' && a.installed)
}
function switchAgent(cmd) {
  if (cmd === 'market') return router.push({ path: '/market', query: {} })
  appId.value = cmd ? Number(cmd) : null
  currentId.value = null
}
watch(appId, async id => {
  const q = { ...route.query }
  if (id) q.app = String(id)
  else delete q.app
  delete q.c
  router.replace({ query: q })
  await loadAgent()
})

const prefs = reactive({ visible: false, loading: false, saving: false, list: [] })
async function openToolPrefs() {
  Object.assign(prefs, { visible: true, loading: true, list: [] })
  try { prefs.list = (await meApi.assistantApps()) || [] } finally { prefs.loading = false }
}
async function saveToolPrefs() {
  prefs.saving = true
  try {
    await meApi.setAssistantApps(prefs.list.filter(a => !a.enabled).map(a => a.code))
    ElMessage.success('已保存，新对话生效')
    prefs.visible = false
    assistant.loadStatus(true)
  } finally {
    prefs.saving = false
  }
}
const listOpen = ref(false)
const chatRef = ref(null)

const currentTitle = computed(() => {
  const c = conversations.value.find(x => String(x.id) === String(currentId.value))
  return c?.title || (currentId.value ? '对话' : '新对话')
})

// 当前会话记住的模型：null = 默认；新会话/未知 = undefined（ChatPanel 用上次选的）
const currentModelId = computed(() => {
  if (!currentId.value) return undefined
  const c = conversations.value.find(x => String(x.id) === String(currentId.value))
  return c ? (c.modelId ?? null) : undefined
})

function getContext() {
  return { route: route.fullPath }
}

async function loadList() {
  loadingList.value = true
  try {
    conversations.value = (await assistantApi.conversations()) || []
  } finally {
    loadingList.value = false
  }
}

function select(id) {
  currentId.value = id
}

function newConversation() {
  currentId.value = null
  chatRef.value && chatRef.value.reset()
}

async function remove(c) {
  try {
    await ElMessageBox.confirm(`删除会话「${c.title || '未命名'}」？`, '删除会话', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  await assistantApi.removeConversation(c.id)
  conversations.value = conversations.value.filter(x => x.id !== c.id)
  if (String(currentId.value) === String(c.id)) newConversation()
  ElMessage.success('已删除')
}

function onConvChange({ id, title, modelId }) {
  if (!id) return
  const exist = conversations.value.find(x => String(x.id) === String(id))
  if (exist) {
    if (title) exist.title = title
    if (modelId !== undefined) exist.modelId = modelId
    exist.updatedAt = new Date().toISOString()
    conversations.value = [exist, ...conversations.value.filter(x => x !== exist)]
  } else {
    conversations.value.unshift({ id, title: title || '新对话', updatedAt: new Date().toISOString(), modelId: modelId ?? null, appId: appId.value || null, versionId: null })
  }
}

// 当前会话同步到 URL，刷新后仍在同一会话
watch(currentId, id => {
  const q = { ...route.query }
  if (id) q.c = String(id)
  else delete q.c
  router.replace({ query: q })
})

onMounted(() => {
  loadList()
  assistant.loadStatus()
  loadAgents()
  loadAgent()
})
</script>

<style scoped>
.assistant-page { display: flex; height: 100%; background: var(--yh-card); }
.conv-side { width: 260px; flex-shrink: 0; border-right: 1px solid var(--yh-border-soft); background: #fafbfc; }
.chat-area { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.chat-head { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 20px; border-bottom: 1px solid var(--yh-border-soft); }
.ch-title { font-weight: 400; flex: 1; font-size: 13px; }
.picker { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 5px 10px; border-radius: 8px; max-width: 280px; outline: none; }
.picker:hover { background: var(--yh-hover); }
.p-icon { font-size: 16px; }
.p-name { font-weight: 600; }
.pref-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--yh-border-soft); }
.small { font-size: 12px; }
:global(.el-dropdown-menu__item.on) { color: var(--yh-primary); font-weight: 500; }
.ch-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.dot-on { width: 7px; height: 7px; border-radius: 50%; background: var(--yh-success); box-shadow: 0 0 0 3px #dcfce7; }
.chat-body { flex: 1; min-height: 0; }
@media (max-width: 767px) {
  .chat-head { padding: 0 6px; height: 46px; }
  .ch-meta { display: none; }
}
</style>

<style>
.conv-drawer .el-drawer__body { padding: 0; }
</style>
