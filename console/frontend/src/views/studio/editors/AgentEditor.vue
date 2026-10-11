<template>
  <div class="agent-editor">
    <!-- 左：配置 -->
    <div class="left">
      <el-form label-position="top">
        <el-form-item>
          <template #label>
            <span>提示词</span>
            <el-dropdown trigger="click" @command="usePreset">
              <el-button link type="primary" size="small">用示例开头</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="p in PRESETS" :key="p.name" :command="p">{{ p.name }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <el-input v-model="payload.prompt" type="textarea" :autosize="{ minRows: 10, maxRows: 24 }" maxlength="8000" show-word-limit
            placeholder="告诉助手：它是谁、帮用户做什么、按什么步骤做、有什么规矩、回答用什么格式。&#10;例如：你是公司的报销顾问。用户问报销问题时，先问清楚是差旅、招待还是采购，再按下面的制度回答……" />
        </el-form-item>

        <el-form-item>
          <template #label>
            <span>可以用的工具 <span class="yh-muted">{{ payload.tools.length }}</span></span>
          </template>
          <div class="tools">
            <el-input v-model="toolKw" size="small" placeholder="搜索工具" clearable class="tool-kw" />
            <div v-loading="toolsLoading" class="tool-list">
              <div v-for="g in toolGroups" :key="g.name" class="tool-group">
                <div class="tg-name">{{ g.name }}</div>
                <label v-for="t in g.tools" :key="t.name" class="tool" :class="{ on: payload.tools.includes(t.name) }">
                  <el-checkbox :model-value="payload.tools.includes(t.name)" @change="v => toggleTool(t.name, v)" />
                  <div class="yh-grow" style="min-width: 0">
                    <div class="t-name">{{ shortLabel(t) }} <el-tag v-if="t.write" size="small" type="warning" effect="plain">写操作</el-tag></div>
                    <div class="t-desc">{{ t.description }}</div>
                  </div>
                </label>
              </div>
              <div v-if="!toolsLoading && !toolGroups.length" class="yh-muted small">没有匹配的工具</div>
            </div>
            <div class="yh-muted small">这里列的是你自己能用的工具。别人用你的助手时，工具以他自己的身份和权限执行；他没权限的工具会自动不可用，写操作都会先让他确认。</div>
          </div>
        </el-form-item>

        <el-form-item label="欢迎语">
          <el-input v-model="payload.greeting" maxlength="500" placeholder="打开时的第一句话（选填），如：你好，我可以帮你查报销标准、准备报销材料" />
        </el-form-item>
        <el-form-item label="开场问题">
          <el-input-tag v-model="payload.starters" :max="6" placeholder="用户可以一键发送的问题，回车添加，最多 6 个" />
        </el-form-item>
        <el-form-item label="模型">
          <el-select v-model="payload.modelId" clearable placeholder="用平台默认模型" style="width: 100%">
            <el-option v-for="m in assistant.models" :key="m.id" :label="m.name" :value="m.id">
              <span>{{ m.name }}</span><span class="yh-muted small" style="float: right">{{ m.description }}</span>
            </el-option>
          </el-select>
          <div class="yh-muted small">不选就跟平台默认模型走；指定的模型对某人不可用时，也会回到默认模型</div>
        </el-form-item>
      </el-form>
    </div>

    <!-- 右：试聊 -->
    <div class="right">
      <div class="right-head">
        <span class="rh-title">试聊</span>
        <span class="yh-muted small">用的是当前草稿（先自动保存），只有你能看到</span>
        <div class="yh-grow"></div>
        <el-button size="small" @click="restartChat">重新开始</el-button>
      </div>
      <div class="chat-wrap">
        <ChatPanel
          :key="chatKey"
          v-model:conversation-id="convId"
          compact
          :agent="agentInfo"
          :app-id="app.id"
          :before-send="() => save(true)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import ChatPanel from '@/components/assistant/ChatPanel.vue'
import { studioApi } from '@/api/market'
import { useAssistantStore } from '@/stores/assistant'
import { useDraft } from './useDraft'

const props = defineProps({ app: { type: Object, required: true } })
const emit = defineEmits(['saving'])
const assistant = useAssistantStore()

const { payload, save } = useDraft(props.app, emit, {
  init: p => {
    p.tools ||= []
    p.starters ||= []
    p.prompt ||= ''
    p.greeting ||= ''
    if (p.modelId === undefined) p.modelId = null
  }
})

const convId = ref(null)
const chatKey = ref(0)
function restartChat() {
  convId.value = null
  chatKey.value++
}
const agentInfo = computed(() => ({
  id: props.app.id, name: props.app.name, icon: props.app.icon, iconColor: props.app.iconColor,
  greeting: payload.value.greeting, starters: payload.value.starters, preview: true
}))

// ---------- 工具 ----------
const tools = ref([])
const toolsLoading = ref(false)
const toolKw = ref('')
const shortLabel = t => (t.appName ? t.label.replace(`${t.appName}：`, '') : t.label)
const toolGroups = computed(() => {
  const k = toolKw.value.trim().toLowerCase()
  const map = new Map()
  // 已选但当前不可用（应用下线了 / 你已看不到）的工具也列出来，方便取消
  const known = new Set(tools.value.map(t => t.name))
  const missing = payload.value.tools.filter(n => !known.has(n)).map(n => ({ name: n, label: n, description: '当前不可用（应用已下线或你看不到它）', appName: '不可用的工具' }))
  for (const t of [...tools.value, ...missing]) {
    if (k && !`${t.label} ${t.description} ${t.appName || ''}`.toLowerCase().includes(k)) continue
    const g = t.appName || '平台通用'
    if (!map.has(g)) map.set(g, [])
    map.get(g).push(t)
  }
  return [...map.entries()].map(([name, list]) => ({ name, tools: list }))
})
function toggleTool(name, on) {
  const set = new Set(payload.value.tools)
  on ? set.add(name) : set.delete(name)
  payload.value.tools = [...set]
}

const PRESETS = [
  { name: '制度问答', prompt: '你是公司的「XX 制度」顾问。\n\n你要做的：\n1. 用户问到相关问题时，按下面的制度原文回答，并说明依据哪一条。\n2. 制度里没写的，直接说「制度里没有规定，请咨询 XX 部门」，不要猜。\n3. 回答先给结论，再给依据，最后给要准备的材料清单。\n\n制度原文：\n（把制度粘贴在这里）' },
  { name: '数据查询', prompt: '你帮用户查询「XX 应用」里的数据。\n\n规则：\n1. 先用工具查，再回答；查不到就如实说。\n2. 多条记录用表格展示，金额保留两位小数。\n3. 用户要做修改时，调用对应的写工具，系统会让他确认。' },
  { name: '写作助手', prompt: '你帮用户写「XX」类文字（周报 / 通知 / 邮件……）。\n\n步骤：\n1. 先问清楚：写给谁、要点是什么、希望多长。\n2. 按下面的格式输出，语气专业、简洁。\n\n格式：\n（写上你们的固定格式）' }
]
function usePreset(p) {
  if (payload.value.prompt.trim()) payload.value.prompt += '\n\n' + p.prompt
  else payload.value.prompt = p.prompt
}

onMounted(async () => {
  assistant.loadStatus()
  toolsLoading.value = true
  try {
    tools.value = (await studioApi.tools()) || []
  } finally {
    toolsLoading.value = false
  }
})
</script>

<style scoped>
.agent-editor { height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 440px); }
.left { overflow-y: auto; padding: 18px 24px 40px; border-right: 1px solid var(--yh-border-soft); }
.left :deep(.el-form-item__label) { display: flex; align-items: center; justify-content: space-between; width: 100%; font-weight: 500; }
.right { display: flex; flex-direction: column; min-height: 0; background: #fafbfc; }
.right-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--yh-border-soft); background: var(--yh-card); }
.rh-title { font-weight: 600; }
.chat-wrap { flex: 1; min-height: 0; position: relative; }
.tools { width: 100%; }
.tool-kw { margin-bottom: 8px; max-width: 260px; }
.tool-list { border: 1px solid var(--yh-border-soft); border-radius: 10px; max-height: 360px; overflow-y: auto; padding: 4px 8px; background: var(--yh-card); margin-bottom: 6px; }
.tool-group + .tool-group { border-top: 1px solid var(--yh-border-soft); }
.tg-name { font-size: 12px; color: var(--yh-text-3); padding: 8px 4px 4px; }
.tool { display: flex; gap: 8px; align-items: flex-start; padding: 6px 4px; border-radius: 6px; cursor: pointer; }
.tool.on { background: var(--yh-primary-soft); }
.t-name { font-size: 13px; font-weight: 500; display: flex; gap: 6px; align-items: center; }
.t-desc { font-size: 12px; color: var(--yh-text-3); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.small { font-size: 12px; }
@media (max-width: 900px) {
  .agent-editor { grid-template-columns: 1fr; grid-template-rows: auto 480px; overflow-y: auto; }
  .left { border-right: none; overflow: visible; }
}
</style>
