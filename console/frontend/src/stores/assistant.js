import { defineStore } from 'pinia'
import { assistantApi } from '@/api/assistant'

const MODEL_KEY = 'yh_assistant_model'
function readLastModel() {
  try {
    const v = localStorage.getItem(MODEL_KEY)
    return v ? Number(v) || null : null
  } catch {
    return null
  }
}

// 助手抽屉的全局状态：任何页面都能「打开助手并发一句话」
export const useAssistantStore = defineStore('assistant', {
  state: () => ({
    drawerOpen: false,
    // 抽屉里当前会话（跨路由保持）
    drawerConversationId: null,
    // 待发送的消息（首页输入框 → 打开抽屉 → 聊天组件消费）
    pendingMessage: null,
    status: null,
    statusLoading: false,
    // 上次选的模型（新建会话用它），localStorage 记住
    lastModelId: readLastModel()
  }),
  getters: {
    models: s => s.status?.models || [],
    defaultModelId: s => s.status?.defaultModelId ?? (s.status?.models || []).find(m => m.isDefault)?.id ?? null,
    allowModelSelect: s => !!s.status?.allowModelSelect
  },
  actions: {
    open(message) {
      this.drawerOpen = true
      if (message && message.trim()) this.pendingMessage = { text: message.trim(), ts: Date.now() }
    },
    close() {
      this.drawerOpen = false
    },
    consumePending() {
      const p = this.pendingMessage
      this.pendingMessage = null
      return p
    },
    /** 模型不存在 / 为空时回退到默认模型 */
    resolveModelId(id) {
      if (id != null && this.models.some(m => String(m.id) === String(id))) return this.models.find(m => String(m.id) === String(id)).id
      return this.defaultModelId
    },
    setLastModel(id) {
      this.lastModelId = id ?? null
      try {
        if (id == null) localStorage.removeItem(MODEL_KEY)
        else localStorage.setItem(MODEL_KEY, String(id))
      } catch { /* 隐私模式等 */ }
    },
    async loadStatus(force = false) {
      if (this.status && !force) return this.status
      this.statusLoading = true
      try {
        this.status = await assistantApi.status()
      } catch (e) {
        this.status = { enabled: false, reason: e.message || '助手状态获取失败', suggestions: [] }
      } finally {
        this.statusLoading = false
      }
      return this.status
    }
  }
})
