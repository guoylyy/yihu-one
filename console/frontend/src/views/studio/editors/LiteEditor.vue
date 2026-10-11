<template>
  <div class="lite-editor">
    <!-- 左：对话生成 -->
    <div class="left">
      <div class="left-tabs">
        <span :class="{ on: side === 'chat' }" @click="side = 'chat'">对话生成</span>
        <span :class="{ on: side === 'code' }" @click="side = 'code'">代码</span>
        <span :class="{ on: side === 'perm' }" @click="side = 'perm'">权限</span>
        <span :class="{ on: side === 'data' }" @click="side = 'data'; loadCollections()">数据</span>
      </div>

      <template v-if="side === 'chat'">
        <div ref="scrollEl" class="msgs">
          <div v-if="!chat.length && !streaming" class="intro">
            <div class="intro-title">⚡ 说说你想要一个什么样的小工具</div>
            <div class="yh-muted small">说清楚：给谁用、要记录哪些信息、谁能看到什么。AI 会生成页面，右边马上能试用；不满意就接着说怎么改。</div>
            <div class="examples">
              <div v-for="e in EXAMPLES" :key="e" class="example" @click="input = e">{{ e }}</div>
            </div>
          </div>
          <div v-for="(m, i) in chat" :key="i" class="msg" :class="m.role">
            <div class="bubble">{{ m.content }}</div>
          </div>
          <div v-if="streaming" class="msg assistant">
            <div class="bubble">
              <div>{{ streamText || '正在思考…' }}</div>
              <div v-if="codeChars" class="yh-muted small"><el-icon class="is-loading"><Loading /></el-icon> 正在写页面代码…（{{ codeChars.toLocaleString() }} 字符）</div>
            </div>
          </div>
          <div v-if="genError" class="gen-error">{{ genError }}</div>
        </div>
        <div class="composer">
          <el-input v-model="input" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" :disabled="streaming" maxlength="4000"
            :placeholder="html ? '说说要怎么改，如：加一个按日期筛选；提交后清空表单' : '例如：做一个会议室预约工具，能选会议室、日期和时间段，已被约的时段不能再约，大家都能看到所有预约'"
            @keydown.enter.exact.prevent="send" />
          <div class="c-bar">
            <span class="yh-muted small">Enter 发送，Shift+Enter 换行</span>
            <el-button v-if="streaming" size="small" @click="stop">停止</el-button>
            <el-button v-else type="primary" size="small" :disabled="!input.trim()" @click="send">{{ html ? '修改' : '生成' }}</el-button>
          </div>
        </div>
      </template>

      <div v-else-if="side === 'code'" class="code-pane">
        <div class="yh-muted small" style="margin-bottom: 8px">可以直接改代码（自动保存）。只能用平台 SDK <code>window.yh</code>，不能联网，<a class="yh-link" @click="sdkVisible = true">查看 SDK 说明</a></div>
        <el-input v-model="payload.html" type="textarea" class="code" spellcheck="false" />
      </div>

      <div v-else-if="side === 'perm'" class="form-pane">
        <div class="yh-muted small" style="margin-bottom: 12px">生成时会按代码自动勾选；别人第一次打开时会看到这些并确认。所有轻应用都能在平台上存自己的数据。</div>
        <el-checkbox v-model="permissions.ai">调用 AI 模型（yh.ai.ask）</el-checkbox>
        <div class="perm-title">调用工具（只读，yh.tools.call）</div>
        <el-select v-model="permissions.tools" multiple filterable placeholder="不调用工具" style="width: 100%">
          <el-option v-for="t in readTools" :key="t.name" :label="`${t.label}（${t.name}）`" :value="t.name" />
        </el-select>
      </div>

      <div v-else class="form-pane">
        <div class="yh-muted small" style="margin-bottom: 12px">这个轻应用存在平台上的数据（预览和正式版共用一份）。可以导出成 Excel 能打开的 CSV。</div>
        <el-table v-loading="colLoading" :data="collections" empty-text="还没有数据">
          <el-table-column label="数据表" prop="name" />
          <el-table-column label="条数" prop="count" width="90" />
          <el-table-column label="" width="90"><template #default="{ row }"><el-button link type="primary" @click="exportCsv(row.name)">导出</el-button></template></el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 右：预览 -->
    <div class="right">
      <div class="right-head">
        <span class="rh-title">预览</span>
        <span class="yh-muted small">当前草稿，可以直接操作（和正式版共用数据）</span>
        <div class="yh-grow"></div>
        <el-button size="small" :disabled="!html" @click="frameKey++">刷新</el-button>
      </div>
      <div class="frame-wrap">
        <LiteFrame v-if="html && draftId" :key="frameKey" :app-id="app.id" :html="html" :version-id="draftId" :app="app" :user="me" />
        <div v-else class="yh-empty">还没有页面，在左边描述需求生成一个</div>
      </div>
    </div>

    <el-dialog v-model="sdkVisible" title="平台 SDK（window.yh）" width="680px">
      <pre class="sdk">{{ SDK_DOC }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import LiteFrame from '@/components/LiteFrame.vue'
import { studioApi, liteApi } from '@/api/market'
import { streamSse } from '@/api/assistant'
import { useUserStore } from '@/stores/user'
import { getToken } from '@/utils/token'
import { useDraft } from './useDraft'

const props = defineProps({ app: { type: Object, required: true } })
const emit = defineEmits(['saving'])
const user = useUserStore()
const me = computed(() => ({ id: user.me?.id, name: user.me?.name, avatar: user.me?.avatar, depts: user.me?.depts || [] }))

const { payload, permissions, save, reload, draftId, replace } = useDraft(props.app, emit, {
  init: (p, perm) => {
    p.html ||= ''
    p.chat ||= []
    if (perm.ai === undefined) perm.ai = false
    if (!Array.isArray(perm.tools)) perm.tools = []
  }
})
const html = computed(() => payload.value.html)
// 生成中先把用户这句话显示出来（不写进草稿：服务端生成完会连同回复一起存）
const pendingUser = ref('')
const chat = computed(() => [...(payload.value.chat || []), ...(pendingUser.value ? [{ role: 'user', content: pendingUser.value }] : [])])
const side = ref('chat')
const frameKey = ref(0)
const sdkVisible = ref(false)

// ---------- 生成 ----------
const input = ref('')
const streaming = ref(false)
const streamText = ref('')
const codeChars = ref(0)
const genError = ref('')
const scrollEl = ref(null)
let ctrl = null

const EXAMPLES = [
  '做一个会议室预约工具：选会议室（大会议室、小会议室、洽谈室）、日期、开始和结束时间、用途；已被约的时段不能再约；所有人都能看到预约列表，只能取消自己的',
  '做一个团队周报收集：每人每周填本周完成、下周计划、需要的支持；所有人能看到大家的周报，按周筛选',
  '做一个报价计算器：输入数量、单价、折扣、是否含税（税率 13%），自动算出不含税价、税额、含税总价，可以保存报价记录'
]

function scrollDown() {
  nextTick(() => { if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight })
}

async function send() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  await save().catch(() => {})
  streaming.value = true
  streamText.value = ''
  codeChars.value = 0
  genError.value = ''
  pendingUser.value = text
  input.value = ''
  scrollDown()
  ctrl = new AbortController()
  let raw = ''
  try {
    await streamSse(`/api/studio/apps/${props.app.id}/generate`, { message: text }, {
      signal: ctrl.signal,
      onEvent: e => {
        if (e.type === 'text') {
          raw += e.delta
          const i = raw.indexOf('```')
          streamText.value = (i >= 0 ? raw.slice(0, i) : raw).trim()
          codeChars.value = i >= 0 ? raw.length - i : 0
          scrollDown()
        } else if (e.type === 'result') {
          if (!e.ok) genError.value = e.message
        } else if (e.type === 'error') {
          genError.value = e.message
        }
      }
    })
  } catch (e) {
    if (e.name !== 'AbortError') genError.value = e.message
  } finally {
    streaming.value = false
    ctrl = null
  }
  // 生成结果已存进草稿：重新拉取（页面代码、对话、自动推断的权限），覆盖本地
  const fresh = await studioApi.get(props.app.id).catch(() => null)
  const w = fresh?.working
  pendingUser.value = ''
  if (w?.status === 'DRAFT') {
    draftId.value = w.id
    replace({ html: w.payload?.html || '', chat: w.payload?.chat || [] }, { ai: !!w.permissions?.ai, tools: [...(w.permissions?.tools || [])] })
    frameKey.value++
    emit('saving', '草稿已保存')
  }
  reload?.()
  scrollDown()
}

function stop() {
  ctrl?.abort()
}

// ---------- 权限 / 数据 ----------
const tools = ref([])
const readTools = computed(() => tools.value.filter(t => !t.write))
const collections = ref([])
const colLoading = ref(false)
async function loadCollections() {
  colLoading.value = true
  try { collections.value = (await liteApi.collections(props.app.id)) || [] } finally { colLoading.value = false }
}
async function exportCsv(name) {
  const res = await fetch(`/api/lite/${props.app.id}/export?collection=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) return ElMessage.error('导出失败')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(await res.blob())
  a.download = `${props.app.name}-${name}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}

const SDK_DOC = `await yh.ready                       // 先等它，之后可以用 yh.user / yh.app
yh.user                              // { id, name, avatar, depts }

await yh.db.list('表名', { where: { 字段: 值 }, scope: 'all' | 'mine' | 'shared', order: '-createdAt', limit: 100 })
await yh.db.get('表名', id)
await yh.db.add('表名', { ...数据 }, { shared: true })   // shared: 所有用户可见；不传 = 只有自己可见
await yh.db.update('表名', id, { ...完整数据 })           // 只能改自己创建的
await yh.db.remove('表名', id)
// 记录：{ id, data, shared, mine, owner: { id, name }, createdAt, updatedAt }

await yh.ai.ask('提示词', { system })   // 需要在「权限」里勾选
await yh.tools.call('工具名', { 参数 })  // 只读工具，需要在「权限」里勾选
yh.toast('保存成功')                    // 第二个参数 'error' 为错误提示

限制：不能联网（外部脚本、字体、图片链接、fetch 都会被拦截），不能用 localStorage / cookie，不能开新窗口。`

onMounted(async () => {
  tools.value = (await studioApi.tools().catch(() => [])) || []
  scrollDown()
})
</script>

<style scoped>
.lite-editor { height: 100%; display: grid; grid-template-columns: minmax(340px, 440px) minmax(0, 1fr); }
.left { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--yh-border-soft); }
.left-tabs { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--yh-border-soft); }
.left-tabs span { padding: 5px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; color: var(--yh-text-2); }
.left-tabs span.on { background: var(--yh-primary-soft); color: var(--yh-primary); font-weight: 500; }
.msgs { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.intro-title { font-weight: 600; font-size: 15px; margin-bottom: 6px; }
.examples { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.example { font-size: 12.5px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--yh-border-soft); cursor: pointer; line-height: 1.6; color: var(--yh-text-2); }
.example:hover { border-color: var(--el-color-primary-light-7); background: var(--yh-fill); }
.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.bubble { max-width: 90%; padding: 9px 12px; border-radius: 12px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.msg.user .bubble { background: var(--yh-primary); color: var(--yh-on-primary); }
.msg.assistant .bubble { background: var(--yh-fill-2); }
.gen-error { font-size: 13px; color: var(--yh-danger); background: #fef2f2; padding: 8px 12px; border-radius: 8px; }
.composer { border-top: 1px solid var(--yh-border-soft); padding: 10px 12px; }
.c-bar { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.code-pane { flex: 1; display: flex; flex-direction: column; padding: 12px; min-height: 0; }
.code { flex: 1; }
.code :deep(textarea) { height: 100% !important; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.55; resize: none; }
.form-pane { padding: 16px; overflow-y: auto; }
.perm-title { font-size: 13px; font-weight: 500; margin: 16px 0 8px; }
.right { display: flex; flex-direction: column; min-height: 0; background: #fafbfc; }
.right-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--yh-border-soft); background: var(--yh-card); }
.rh-title { font-weight: 600; }
.frame-wrap { flex: 1; min-height: 0; background: var(--yh-card); }
.sdk { margin: 0; background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 10px; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; }
.small { font-size: 12px; }
@media (max-width: 900px) {
  .lite-editor { grid-template-columns: 1fr; grid-template-rows: 520px 520px; overflow-y: auto; }
}
</style>
