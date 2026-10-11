<template>
  <div class="chat" :class="{ compact }">
    <!-- 助手未启用 -->
    <div v-if="status && status.enabled === false" class="disabled">
      <div class="disabled-icon">✦</div>
      <div class="disabled-title">AI 助手暂不可用</div>
      <div class="disabled-reason">{{ status.reason || '尚未配置大模型' }}</div>
      <div v-if="/关闭/.test(status.reason || '')" class="disabled-hint">
        管理员可在 <b>管理 → 系统设置 → AI 助手</b> 中开启
        <el-button v-if="user.permissions.admin" link type="primary" @click="$router.push({ path: '/admin', query: { tab: 'settings' } })">去设置</el-button>
      </div>
      <div v-else class="disabled-hint">
        请管理员在 <b>管理 → 模型配置</b> 中配置
        <el-button v-if="user.permissions.admin" link type="primary" @click="$router.push({ path: '/admin', query: { tab: 'llm' } })">去配置</el-button>
      </div>
    </div>

    <template v-else>
      <div ref="scrollEl" class="messages" @scroll="onScroll" @click="onContentClick">
        <div v-if="loadingHistory" class="history-loading"><el-icon class="is-loading"><Loading /></el-icon> 加载会话…</div>

        <!-- 欢迎页 -->
        <div v-else-if="!messages.length" class="welcome">
          <AppIcon v-if="agent" class="welcome-icon" :icon="agent.icon || '✦'" :name="agent.name" :color="agent.iconColor" :size="56" />
          <div v-else class="welcome-logo">✦</div>
          <template v-if="agent">
            <div class="welcome-title">{{ agent.name }}</div>
            <div class="welcome-sub">{{ agent.greeting || `你好${user.me?.name ? '，' + user.me.name : ''}，有什么需要帮忙？` }}</div>
          </template>
          <template v-else>
            <div class="welcome-title">你好{{ user.me?.name ? '，' + user.me.name : '' }}，我是你的{{ status?.name || 'AI 助手' }}</div>
            <div class="welcome-sub">
              我能调用平台上各个应用的能力，帮你查询和办理。涉及办理的操作都会先请你确认。
            </div>
          </template>
          <div v-if="suggestions.length" class="suggestions">
            <button v-for="s in suggestions" :key="s" class="suggestion" @click="send(s)">
              <span>{{ s }}</span><el-icon><Right /></el-icon>
            </button>
          </div>
        </div>

        <template v-for="m in messages" :key="m.key">
          <!-- 用户 -->
          <div v-if="m.role === 'user'" class="msg user">
            <div class="bubble">{{ m.text }}</div>
          </div>

          <!-- 助手 -->
          <div v-else-if="m.role === 'assistant'" class="msg assistant">
            <div class="avatar">✦</div>
            <div class="body">
              <div v-if="m.tools && m.tools.length" class="tools">
                <el-tooltip v-for="t in m.tools" :key="t.id || t.name" :content="t.summary || t.label || t.name" placement="top" :disabled="!t.summary">
                  <span class="tool" :class="t.status">
                    <template v-if="t.status === 'running'"><span class="spin">🔧</span> {{ t.label || t.name }}…</template>
                    <template v-else-if="t.status === 'ok'"><span class="ok">✓</span> {{ t.label || t.name }}</template>
                    <template v-else-if="t.status === 'pending'"><span class="pending">⏳</span> {{ t.label || t.name }} · 待确认</template>
                    <template v-else><span class="fail">✗</span> {{ t.label || t.name }}</template>
                  </span>
                </el-tooltip>
              </div>
              <div v-if="m.text" class="md" v-html="renderMarkdown(m.text)"></div>
              <div v-if="m.streaming && !m.text && !hasRunningTool(m)" class="typing"><i></i><i></i><i></i></div>
              <div v-if="m.error" class="msg-error"><el-icon><WarningFilled /></el-icon> {{ m.error }}</div>
              <div v-if="m.model && !m.streaming" class="answered-by">由 {{ m.model.name }} 回答</div>
            </div>
          </div>

          <!-- 写操作确认卡片 -->
          <div v-else-if="m.role === 'event'" class="msg assistant">
            <div class="avatar ghost"></div>
            <div class="confirm-card" :class="['st-' + m.action.status]">
              <div class="cc-head">
                <el-icon><Stamp /></el-icon>
                <span class="cc-title">{{ m.action.label || '需要你确认的操作' }}</span>
                <el-tag v-if="m.action.status !== 'PENDING'" size="small" :type="actionMeta(m.action.status).type" effect="plain" round>
                  {{ actionMeta(m.action.status).label }}
                </el-tag>
              </div>
              <div class="cc-summary">{{ m.action.summary }}</div>
              <div v-if="m.action.resultMessage" class="cc-result">{{ m.action.resultMessage }}</div>
              <div v-if="m.action.status === 'PENDING'" class="cc-actions">
                <el-button size="small" :disabled="m.busy" @click="cancelAction(m)">取消</el-button>
                <el-button size="small" type="primary" :loading="m.busy === 'confirm'" :disabled="!!m.busy" @click="confirmAction(m)">确认执行</el-button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="composer">
        <div v-if="showModelPicker" class="composer-bar">
          <el-dropdown trigger="click" placement="top-start" :disabled="streaming" @command="selectModel">
            <button type="button" class="model-btn" :title="currentModel?.description || ''">
              <span class="model-dot"></span>
              <span class="model-name">{{ currentModel?.name || '选择模型' }}</span>
              <el-icon class="model-arrow"><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu class="model-menu">
                <el-dropdown-item v-for="md in assistant.models" :key="md.id" :command="md.id" :class="{ 'is-current': String(md.id) === String(modelId) }">
                  <div class="mi">
                    <div class="mi-top">
                      <span class="mi-name">{{ md.name }}</span>
                      <el-tag v-if="md.isDefault" size="small" effect="plain" round>默认</el-tag>
                      <el-icon v-if="String(md.id) === String(modelId)" class="mi-check"><Check /></el-icon>
                    </div>
                    <div v-if="md.description" class="mi-desc">{{ md.description }}</div>
                  </div>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="input-box" :class="{ focused }">
          <el-input
            ref="inputRef"
            v-model="input"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 6 }"
            resize="none"
            :placeholder="placeholder"
            @focus="focused = true"
            @blur="focused = false"
            @keydown.enter="onEnter"
            @compositionstart="composing = true"
            @compositionend="composing = false"
          />
          <el-button v-if="streaming" class="send stop" circle @click="stop" title="停止">
            <el-icon><VideoPause /></el-icon>
          </el-button>
          <el-button v-else class="send" type="primary" circle :disabled="!input.trim()" @click="send()" title="发送">
            <el-icon><Promotion /></el-icon>
          </el-button>
        </div>
        <div class="composer-tip">AI 生成内容仅供参考 · 办理类操作需你确认后才会执行</div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Loading, Right, WarningFilled, Stamp, VideoPause, Promotion, ArrowDown, Check } from '@element-plus/icons-vue'
import { assistantApi, streamChat } from '@/api/assistant'
import { useUserStore } from '@/stores/user'
import { useAssistantStore } from '@/stores/assistant'
import { renderMarkdown } from '@/utils/markdown'
import { ACTION_STATUS } from '@/utils/constants'
import { useMobile } from '@/utils/useMobile'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  conversationId: { type: [Number, String], default: null },
  // () => ({ route })，每次发送时取当前值
  getContext: { type: Function, default: null },
  compact: { type: Boolean, default: false },
  // 抽屉模式：消费 store 里的 pendingMessage（首页输入框发来的）
  consumePending: { type: Boolean, default: false },
  // 当前会话记住的模型（会话列表里的 modelId）；undefined 表示父组件不知道，null 表示默认模型
  conversationModelId: { type: [Number, String, null], default: undefined },
  // 市场里的 AI 助手：{ id, name, icon, greeting, starters }；为空 = 默认助手
  agent: { type: Object, default: null },
  appId: { type: [Number, String], default: null },
  // 发送前调用（创作中心试聊：先存草稿），返回要试聊的草稿版本 id
  beforeSend: { type: Function, default: null }
})
const emit = defineEmits(['update:conversationId', 'conversation-change'])

const router = useRouter()
const user = useUserStore()
const assistant = useAssistantStore()
const isMobile = useMobile()

const messages = ref([])
const input = ref('')
const streaming = ref(false)
const loadingHistory = ref(false)
const focused = ref(false)
const composing = ref(false)
const scrollEl = ref(null)
const inputRef = ref(null)
let stickToBottom = true
let abortCtrl = null
let keySeq = 0
// 本组件通过 meta 事件拿到的新会话 id：父组件回传时不需要重新加载历史
let selfAssignedId = null

const status = computed(() => assistant.status)
const suggestions = computed(() => (props.agent ? props.agent.starters || [] : status.value?.suggestions || []))
const placeholder = computed(() => (props.compact || isMobile.value ? '问问助手，Enter 发送' : '有什么需要帮忙？例如「我能用哪些应用」，Enter 发送，Shift+Enter 换行'))

// ---------- 模型选择 ----------
const modelId = ref(null)
let roundModel = null
const showModelPicker = computed(() => assistant.allowModelSelect && assistant.models.length > 1)
const currentModel = computed(() => assistant.models.find(m => String(m.id) === String(modelId.value)) || null)

function selectModel(id) {
  modelId.value = id
  assistant.setLastModel(id)
}
/** 按会话同步选择器：切到旧会话 → 它记住的模型；新会话 → 上次选的 */
function syncModelForConversation() {
  if (!assistant.models.length) return
  if (props.conversationId && props.conversationModelId !== undefined) modelId.value = assistant.resolveModelId(props.conversationModelId)
  else if (!props.conversationId) modelId.value = assistant.resolveModelId(assistant.lastModelId)
  else if (modelId.value == null) modelId.value = assistant.resolveModelId(assistant.lastModelId)
}
watch(() => [props.conversationId, props.conversationModelId, assistant.models], syncModelForConversation)

const nextKey = () => `m${++keySeq}`
const actionMeta = s => ACTION_STATUS[s] || { label: s, type: 'info' }
const hasRunningTool = m => (m.tools || []).some(t => t.status === 'running')

// ---------- 历史 ----------
function fromDisplay(list) {
  return (list || []).map(d => {
    if (d.role === 'user') return { key: nextKey(), role: 'user', text: d.text }
    if (d.role === 'event') return { key: nextKey(), role: 'event', action: { ...d.action }, busy: false }
    return {
      key: nextKey(),
      role: 'assistant',
      text: d.text || '',
      tools: (d.tools || []).map((t, i) => ({ id: t.id || `${d.id}-${i}`, name: t.name, label: t.label, status: t.ok === false ? 'fail' : 'ok' })),
      streaming: false
    }
  })
}

async function loadHistory(id) {
  stop()
  if (!id) {
    messages.value = []
    return
  }
  loadingHistory.value = true
  try {
    const list = await assistantApi.messages(id)
    messages.value = fromDisplay(list)
    stickToBottom = true
    scrollToBottom(true)
  } catch {
    messages.value = []
  } finally {
    loadingHistory.value = false
  }
}

watch(
  () => props.conversationId,
  id => {
    if (id && selfAssignedId && String(id) === String(selfAssignedId)) return
    selfAssignedId = null
    loadHistory(id)
  }
)

// ---------- 发送 / 流 ----------
function onEnter(e) {
  if (e.shiftKey || composing.value || e.isComposing) return
  e.preventDefault()
  send()
}

function lastAssistant() {
  const last = messages.value[messages.value.length - 1]
  if (last && last.role === 'assistant' && last.streaming) return last
  const m = { key: nextKey(), role: 'assistant', text: '', tools: [], streaming: true }
  messages.value.push(m)
  return messages.value[messages.value.length - 1]
}

function handleEvent(evt) {
  switch (evt.type) {
    case 'meta':
      if (evt.conversationId && String(evt.conversationId) !== String(props.conversationId)) {
        selfAssignedId = evt.conversationId
        emit('update:conversationId', evt.conversationId)
      }
      // meta.model 是这一轮实际用的模型（无权使用所选模型时后端回退到默认），以它为准
      if (evt.model) {
        roundModel = evt.model
        if (modelId.value != null && String(evt.model.id) !== String(modelId.value)) {
          ElMessage.info(`你选的模型暂不可用，本次由 ${evt.model.name} 回答`)
        }
        modelId.value = evt.model.id
        assistant.setLastModel(evt.model.id)
      }
      emit('conversation-change', { id: evt.conversationId, title: evt.title, modelId: evt.model?.id })
      break
    case 'text':
      lastAssistant().text += evt.delta || ''
      break
    case 'tool_call': {
      const m = lastAssistant()
      m.tools.push({ id: evt.id, name: evt.name, label: evt.label, status: 'running' })
      break
    }
    case 'tool_result': {
      // 在所有助手消息里找对应的工具（可能跨越了确认卡片）
      for (let i = messages.value.length - 1; i >= 0; i--) {
        const m = messages.value[i]
        const t = m.role === 'assistant' && (m.tools || []).find(x => x.id === evt.id)
        if (t) {
          t.status = evt.ok === false ? 'fail' : evt.pending ? 'pending' : 'ok'
          t.summary = evt.summary
          break
        }
      }
      break
    }
    case 'confirm': {
      const cur = messages.value[messages.value.length - 1]
      if (cur && cur.role === 'assistant') cur.streaming = false
      messages.value.push({ key: nextKey(), role: 'event', action: { ...evt.action, status: 'PENDING' }, busy: false })
      break
    }
    case 'error': {
      const m = lastAssistant()
      m.error = evt.message || '助手出错了'
      break
    }
    case 'done':
      finishStreaming()
      break
  }
  scrollToBottom()
}

function finishStreaming() {
  messages.value.forEach(m => {
    if (m.role === 'assistant' && m.streaming) {
      m.streaming = false
      ;(m.tools || []).forEach(t => { if (t.status === 'running') t.status = 'ok' })
    }
  })
  // 空的占位消息去掉
  messages.value = messages.value.filter(m => !(m.role === 'assistant' && !m.text && !m.error && !(m.tools || []).length))
  // 「由 XX 回答」只标在这一轮最后一条助手消息下
  if (roundModel) {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m.role === 'user') break
      if (m.role === 'assistant') { m.model = roundModel; break }
    }
  }
  roundModel = null
  streaming.value = false
  abortCtrl = null
}

async function send(text) {
  const content = (text ?? input.value).trim()
  if (!content || streaming.value) return
  if (status.value && status.value.enabled === false) return
  if (text === undefined) input.value = ''

  messages.value.push({ key: nextKey(), role: 'user', text: content })
  messages.value.push({ key: nextKey(), role: 'assistant', text: '', tools: [], streaming: true })
  streaming.value = true
  stickToBottom = true
  scrollToBottom(true)

  abortCtrl = new AbortController()
  const body = { message: content }
  if (props.conversationId) body.conversationId = props.conversationId
  if (props.appId) body.appId = props.appId
  if (props.beforeSend) {
    try {
      // 每次发送前都把没保存的修改存上；版本 id 只在新会话时带（会话绑定到这个草稿）
      const vid = await props.beforeSend()
      if (vid && !props.conversationId) body.versionId = vid
    } catch (e) {
      lastAssistant().error = `草稿没保存成功：${e.message}`
      finishStreaming()
      return
    }
  }
  if (modelId.value != null) body.modelId = modelId.value
  roundModel = null
  const ctx = props.getContext ? props.getContext() : null
  if (ctx) body.context = ctx

  try {
    await streamChat(body, { onEvent: handleEvent, signal: abortCtrl.signal })
  } catch (e) {
    if (e.name !== 'AbortError') {
      const m = lastAssistant()
      m.error = e.message || '连接中断'
      if (e.status === 401) {
        user.logout()
        router.replace({ name: 'Login', query: { redirect: router.currentRoute.value.fullPath } })
      }
    }
  } finally {
    if (streaming.value) finishStreaming()
    scrollToBottom()
  }
}

function stop() {
  if (abortCtrl) {
    abortCtrl.abort()
    abortCtrl = null
  }
}

// ---------- 确认卡片 ----------
async function confirmAction(m) {
  m.busy = 'confirm'
  try {
    const res = await assistantApi.confirm(m.action.id)
    m.action.status = res && res.ok === false ? 'FAILED' : 'CONFIRMED'
    m.action.resultMessage = res?.message || (m.action.status === 'CONFIRMED' ? '已执行' : '执行失败')
    if (m.action.status === 'CONFIRMED') ElMessage.success(m.action.resultMessage)
  } catch (e) {
    m.action.status = 'FAILED'
    m.action.resultMessage = e.message
  } finally {
    m.busy = false
    scrollToBottom()
  }
}

async function cancelAction(m) {
  m.busy = 'cancel'
  try {
    await assistantApi.cancel(m.action.id)
    m.action.status = 'CANCELLED'
    m.action.resultMessage = '已取消，未执行任何操作'
  } catch {
    /* 已提示 */
  } finally {
    m.busy = false
  }
}

// ---------- 滚动 / 链接 ----------
function onScroll() {
  const el = scrollEl.value
  if (!el) return
  stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function scrollToBottom(force = false) {
  nextTick(() => {
    const el = scrollEl.value
    if (el && (force || stickToBottom)) el.scrollTop = el.scrollHeight
  })
}

function onContentClick(e) {
  const a = e.target.closest && e.target.closest('a[data-internal]')
  if (a) {
    e.preventDefault()
    router.push(a.getAttribute('href'))
  }
}

// ---------- 首页输入框 → 抽屉 ----------
function tryConsumePending() {
  if (!props.consumePending || !assistant.pendingMessage) return
  if (streaming.value) return
  const p = assistant.consumePending()
  if (p) send(p.text)
}
watch(() => assistant.pendingMessage, () => nextTick(tryConsumePending))

onMounted(async () => {
  await assistant.loadStatus()
  syncModelForConversation()
  if (props.conversationId) await loadHistory(props.conversationId)
  tryConsumePending()
})
onBeforeUnmount(stop)

function focus() {
  inputRef.value && inputRef.value.focus()
}

function reset() {
  stop()
  selfAssignedId = null
  messages.value = []
}

defineExpose({ send, focus, reset })
</script>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--yh-card); }

.messages { flex: 1; overflow-y: auto; padding: 24px 28px 12px; scroll-behavior: smooth; }
.compact .messages { padding: 16px 16px 8px; }

.history-loading { color: var(--yh-text-3); text-align: center; padding: 40px 0; display: flex; align-items: center; justify-content: center; gap: 6px; }

/* 欢迎 */
.welcome { max-width: 560px; margin: 6vh auto 0; text-align: center; }
.compact .welcome { margin-top: 24px; }
.welcome-logo {
  width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center; font-size: 26px; color: var(--yh-on-primary);
  background: var(--yh-gradient);
  box-shadow: var(--yh-glow-shadow);
}
.welcome-icon { display: flex; margin: 0 auto 16px; }
.welcome-title { font-size: 18px; font-weight: 600; }
.welcome-sub { color: var(--yh-text-2); margin-top: 8px; font-size: 13px; line-height: 1.7; }
.suggestions { display: flex; flex-direction: column; gap: 8px; margin-top: 24px; text-align: left; }
.suggestion {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 11px 14px; border-radius: 10px; border: 1px solid var(--yh-border);
  background: var(--yh-card); color: var(--yh-text); cursor: pointer; font-size: 13px; text-align: left;
  transition: all .15s; font-family: inherit;
}
.suggestion:hover { border-color: var(--el-color-primary-light-7); background: var(--yh-fill); color: var(--yh-primary); }
.suggestion .el-icon { color: var(--yh-text-3); flex-shrink: 0; }

/* 消息 */
.msg { display: flex; gap: 10px; margin-bottom: 18px; max-width: 860px; margin-left: auto; margin-right: auto; }
.msg.user { justify-content: flex-end; }
.msg.user .bubble {
  max-width: 80%; background: var(--yh-primary); color: var(--yh-on-primary); padding: 9px 14px;
  border-radius: 14px 14px 4px 14px; white-space: pre-wrap; word-break: break-word; line-height: 1.6;
}
.avatar {
  width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; margin-top: 2px;
  display: flex; align-items: center; justify-content: center; color: var(--yh-on-primary); font-size: 14px;
  background: var(--yh-gradient);
}
.avatar.ghost { background: transparent; }
.body { flex: 1; min-width: 0; }

.tools { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.tool {
  display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--yh-text-2);
  background: var(--yh-fill-2); border-radius: 6px; padding: 2px 8px; line-height: 20px;
}
.tool.running { color: var(--yh-text-3); }
.tool .ok { color: var(--yh-success); font-weight: 600; }
.tool .fail { color: var(--yh-danger); font-weight: 600; }
.tool.fail { background: #fef2f2; }
.tool.pending { background: #fff7ed; color: #c2410c; }
.spin { display: inline-block; animation: wobble 1s ease-in-out infinite; }
@keyframes wobble { 0%, 100% { transform: rotate(-15deg); } 50% { transform: rotate(15deg); } }

.typing { display: inline-flex; gap: 4px; padding: 10px 2px; }
.typing i { width: 6px; height: 6px; border-radius: 50%; background: #a5b4fc; animation: blink 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .2s; }
.typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }

.msg-error { color: var(--yh-danger); font-size: 13px; display: flex; align-items: center; gap: 4px; margin-top: 4px; }

/* Markdown */
.md { line-height: 1.75; color: var(--yh-text); word-break: break-word; }
.md :deep(p) { margin: 0 0 8px; }
.md :deep(p:last-child) { margin-bottom: 0; }
.md :deep(ul), .md :deep(ol) { padding-left: 20px; margin: 4px 0 8px; }
.md :deep(li) { margin: 2px 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) { font-size: 15px; margin: 12px 0 6px; }
.md :deep(code) { background: var(--yh-fill-2); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.md :deep(pre) { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
.md :deep(pre code) { background: transparent; color: inherit; padding: 0; }
.md :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: 13px; display: block; overflow-x: auto; }
.md :deep(th), .md :deep(td) { border: 1px solid var(--yh-border); padding: 6px 10px; text-align: left; }
.md :deep(th) { background: var(--yh-fill); font-weight: 500; }
.md :deep(blockquote) { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--el-color-primary-light-7); color: var(--yh-text-2); background: var(--yh-fill); }
.md :deep(a) { color: var(--yh-primary); }
.md :deep(img) { max-width: 100%; }

/* 确认卡片 */
.confirm-card {
  flex: 1; max-width: 520px; border: 1px solid var(--el-color-primary-light-7); border-radius: 12px; padding: 14px 16px;
  background: linear-gradient(180deg, var(--yh-fill) 0%, var(--yh-card) 100%);
  box-shadow: 0 2px 10px rgba(var(--yh-primary-rgb), .08);
}
.cc-head { display: flex; align-items: center; gap: 8px; color: var(--yh-primary); }
.cc-title { font-weight: 600; color: var(--yh-text); flex: 1; }
.cc-summary { margin-top: 8px; white-space: pre-wrap; color: var(--yh-text-2); line-height: 1.7; font-size: 13px; }
.cc-result { white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #f0fdf4; color: #166534; font-size: 13px; }
.cc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.confirm-card:not(.st-PENDING) { border-color: var(--yh-border); background: #fafafa; box-shadow: none; }
.confirm-card:not(.st-PENDING) .cc-head, .confirm-card:not(.st-PENDING) .cc-title, .confirm-card:not(.st-PENDING) .cc-summary { color: var(--yh-text-3); }
.confirm-card.st-FAILED .cc-result, .confirm-card.st-EXPIRED .cc-result { background: #fef2f2; color: #991b1b; }
.confirm-card.st-CANCELLED .cc-result { background: var(--yh-fill-2); color: var(--yh-text-3); }

/* 输入区 */
.composer { padding: 10px 24px 14px; border-top: 1px solid transparent; }
.compact .composer { padding: 10px 14px 12px; border-top-color: var(--yh-border-soft); }
.input-box {
  max-width: 860px; margin: 0 auto; display: flex; align-items: flex-end; gap: 8px;
  border: 1px solid var(--yh-border); border-radius: 14px; padding: 8px 8px 8px 12px; background: var(--yh-card);
  transition: border-color .15s, box-shadow .15s; box-shadow: 0 2px 8px rgba(16, 24, 40, .04);
}
.input-box.focused { border-color: var(--el-color-primary-light-5); box-shadow: 0 0 0 3px rgba(var(--yh-primary-rgb), .1); }
.input-box :deep(.el-textarea__inner) { box-shadow: none !important; padding: 5px 0; background: transparent; font-size: 14px; line-height: 1.6; }
.send { flex-shrink: 0; width: 34px; height: 34px; }
.send.stop { color: var(--yh-danger); border-color: #fecaca; }
.composer-bar { max-width: 860px; margin: 0 auto 6px; display: flex; align-items: center; }
.model-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px; cursor: pointer;
  border: 1px solid var(--yh-border); background: var(--yh-card); color: var(--yh-text-2); font-size: 12px; font-family: inherit; max-width: 240px;
}
.model-btn:hover { border-color: var(--el-color-primary-light-7); color: var(--yh-ai); }
.model-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--yh-gradient); flex-shrink: 0; }
.model-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-arrow { font-size: 11px; color: var(--yh-text-3); }
.mi { padding: 2px 0; min-width: 220px; max-width: 300px; }
.mi-top { display: flex; align-items: center; gap: 6px; }
.mi-name { font-weight: 500; color: var(--yh-text); }
.mi-check { margin-left: auto; color: var(--yh-primary); }
.mi-desc { font-size: 12px; color: var(--yh-text-3); line-height: 1.5; white-space: normal; }
.answered-by { margin-top: 6px; font-size: 11.5px; color: var(--yh-text-3); }
.composer-tip { text-align: center; color: var(--yh-text-3); font-size: 11px; margin-top: 6px; }

/* 未启用 */
.disabled { margin: auto; text-align: center; padding: 40px 24px; max-width: 420px; }
.disabled-icon { font-size: 30px; color: #c4b5fd; }
.disabled-title { font-size: 16px; font-weight: 600; margin-top: 8px; }
.disabled-reason { color: var(--yh-text-2); margin-top: 8px; }
.disabled-hint { color: var(--yh-text-3); margin-top: 12px; font-size: 13px; }

@media (max-width: 767px) {
  .messages { padding: 16px 12px 8px; }
  .composer { padding: 8px 10px 10px; }
  .msg.user .bubble { max-width: 88%; }
}
</style>
