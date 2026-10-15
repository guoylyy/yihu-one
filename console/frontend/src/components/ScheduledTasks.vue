<template>
  <!-- 个人中心：定时 AI 任务。到点以我的身份让 AI 助手做一件事（只能查、不能改），结果推到我的钉钉 / 飞书 / 企业微信，并存成对话 -->
  <div class="yh-card" v-loading="loading">
    <div class="yh-card-header">
      <div>
        <div class="yh-card-title">定时任务</div>
        <div class="yh-muted small">到点让 AI 助手替你查一遍、汇总好推到手机上。只能查数据，不会替你改任何东西</div>
      </div>
      <div class="actions">
        <el-button v-if="!hasBrief" size="small" @click="createBrief">开通每日经营简报</el-button>
        <el-button size="small" type="primary" :icon="Plus" @click="openEdit()">新建</el-button>
      </div>
    </div>
    <el-empty v-if="!loading && !tasks.length" description="还没有定时任务" :image-size="60" />
    <div v-for="t in tasks" :key="t.id" class="task">
      <div class="t-main">
        <div class="t-name">
          {{ t.name }}
          <el-tag size="small" effect="plain">{{ t.scheduleText }}</el-tag>
          <el-tag v-if="!t.enabled" size="small" type="info" effect="plain">已暂停</el-tag>
        </div>
        <div class="t-sub">
          <template v-if="t.lastStatus === 'RUNNING'">正在运行…</template>
          <template v-else-if="t.lastRunAt">上次 {{ formatDateTime(t.lastRunAt) }} {{ t.lastStatus === 'OK' ? '成功' : '失败' }}</template>
          <template v-else>还没运行过</template>
          <template v-if="t.enabled && t.nextRunAt"> · 下次 {{ formatDateTime(t.nextRunAt) }}</template>
        </div>
        <div v-if="t.lastError" class="t-err" :class="{ warn: t.lastStatus === 'OK' }">{{ t.lastError }}</div>
      </div>
      <div class="t-ops">
        <el-button v-if="t.lastConversationId" link type="primary" @click="openConv(t)">看结果</el-button>
        <el-button link :disabled="t.lastStatus === 'RUNNING'" @click="run(t)">立即运行</el-button>
        <el-switch :model-value="t.enabled" size="small" @change="v => toggle(t, v)" />
        <el-button link @click="openEdit(t)">编辑</el-button>
        <el-button link type="danger" @click="remove(t)">删除</el-button>
      </div>
    </div>

    <el-dialog v-model="dlg.visible" :title="dlg.id ? '编辑定时任务' : '新建定时任务'" width="560px">
      <el-form label-width="84px">
        <el-form-item label="名称"><el-input v-model="dlg.name" maxlength="60" placeholder="如：本周项目进展" /></el-form-item>
        <el-form-item label="什么时候">
          <el-select v-model="dlg.kind" style="width: 110px">
            <el-option label="每天" value="daily" /><el-option label="工作日" value="weekdays" /><el-option label="每周" value="weekly" />
          </el-select>
          <el-select v-if="dlg.kind === 'weekly'" v-model="dlg.weekday" style="width: 90px; margin-left: 8px">
            <el-option v-for="(w, i) in WEEK" :key="i" :label="`周${w}`" :value="i + 1" />
          </el-select>
          <el-time-select v-model="dlg.time" start="06:00" step="00:30" end="23:30" style="width: 120px; margin-left: 8px" />
        </el-form-item>
        <el-form-item label="做什么">
          <el-input v-model="dlg.prompt" type="textarea" :rows="6" maxlength="4000" show-word-limit placeholder="像对助手说话一样写清楚，如：汇总本周各项目的进展和风险，按项目列出，最后给出需要我关注的事" />
        </el-form-item>
        <el-form-item label="用哪个助手">
          <el-select v-model="dlg.agentAppId" clearable placeholder="默认助手" style="width: 100%">
            <el-option v-for="a in agents" :key="a.id" :label="a.name" :value="a.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { meApi } from '@/api/me'
import { marketApi } from '@/api/market'
import { formatDateTime } from '@/utils/format'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const router = useRouter()
const tasks = ref([])
const agents = ref([])
const loading = ref(false)
const hasBrief = computed(() => tasks.value.some(t => t.template === 'brief'))
const dlg = reactive({ visible: false, saving: false, id: null, name: '', prompt: '', kind: 'weekdays', time: '08:00', weekday: 5, agentAppId: null })
let timer = null

async function load() {
  loading.value = !tasks.value.length
  try { tasks.value = (await meApi.scheduledTasks()) || [] } finally { loading.value = false }
  clearTimeout(timer)
  if (tasks.value.some(t => t.lastStatus === 'RUNNING')) timer = setTimeout(load, 5000)
}
async function loadAgents() {
  try {
    const r = await marketApi.list({ kind: 'AGENT' })
    agents.value = (r?.apps || []).filter(a => a.kind === 'AGENT')
  } catch { agents.value = [] }
}
function openEdit(t) {
  Object.assign(dlg, t
    ? { id: t.id, name: t.name, prompt: t.prompt, kind: t.schedule.kind, time: t.schedule.time, weekday: t.schedule.weekday || 5, agentAppId: t.agentAppId }
    : { id: null, name: '', prompt: '', kind: 'weekdays', time: '08:00', weekday: 5, agentAppId: null })
  dlg.visible = true
}
async function save() {
  dlg.saving = true
  try {
    const body = { name: dlg.name, prompt: dlg.prompt, agentAppId: dlg.agentAppId || null, schedule: { kind: dlg.kind, time: dlg.time, ...(dlg.kind === 'weekly' ? { weekday: dlg.weekday } : {}) } }
    if (dlg.id) await meApi.updateTask(dlg.id, body)
    else await meApi.createTask(body)
    dlg.visible = false
    ElMessage.success('已保存')
    load()
  } finally {
    dlg.saving = false
  }
}
async function createBrief() {
  await meApi.createBrief({ kind: 'weekdays', time: '08:00' })
  ElMessage.success('已开通：工作日 8:00 推送，第一份正在生成')
  load()
}
async function run(t) {
  await meApi.runTask(t.id)
  ElMessage.success('已开始，大约一分钟后看结果')
  load()
}
async function toggle(t, v) {
  await meApi.updateTask(t.id, { enabled: v })
  load()
}
async function remove(t) {
  await ElMessageBox.confirm(`删除定时任务「${t.name}」？`, '删除', { type: 'warning' })
  await meApi.deleteTask(t.id)
  load()
}
function openConv(t) {
  router.push({ path: '/assistant', query: { c: t.lastConversationId, ...(t.agentAppId ? { app: t.agentAppId } : {}) } })
}
onMounted(() => { load(); loadAgents() })
onBeforeUnmount(() => clearTimeout(timer))
</script>

<style scoped>
.actions { display: flex; gap: 8px; }
.task { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--yh-border-soft); flex-wrap: wrap; }
.task:last-child { border-bottom: none; }
.t-main { min-width: 0; flex: 1; }
.t-name { font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.t-sub { font-size: 12px; color: var(--yh-text-3); margin-top: 4px; }
.t-err { font-size: 12px; color: var(--yh-danger); margin-top: 4px; }
.t-err.warn { color: var(--yh-warning); }
.t-ops { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.small { font-size: 12px; }
</style>
