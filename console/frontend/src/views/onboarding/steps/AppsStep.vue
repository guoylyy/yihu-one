<template>
  <div v-loading="!data" class="ob-form">
    <template v-if="data">
      <div class="ob-section">
        <div class="ob-section-title">已预置</div>
        <div class="ob-box app-row">
          <div class="yh-grow">
            <b>{{ data.boss?.name || '老板助理' }}</b>
            <div class="yh-muted small">给管理层的 AI 助理：问公司状况、风险和待决定的事，每天推送经营简报。默认只有管理员和部门负责人能看到，可以在创作中心里改设定和可见范围</div>
          </div>
          <el-button v-if="data.boss" size="small" @click="$router.push(`/market/${data.boss.id}`)">查看</el-button>
        </div>
      </div>

      <div class="ob-section">
        <div class="ob-section-title">官方应用</div>
        <el-alert
          v-if="!data.agent.online"
          type="warning"
          :closable="false"
          show-icon
          class="agent-warn"
          title="宿主机上的 yh agent 没有在运行"
          description="安装由平台机器上的 yh agent 执行。它不在线时安装会一直排队：在平台目录里运行 ./yh autostart（开机自启 + 常驻 agent），或者让部署工程师看一下。"
        />
        <div v-for="a in data.apps" :key="a.code" class="ob-box app-row">
          <AppIcon :icon="a.icon" :name="a.name" :size="40" class="app-icon" />
          <div class="yh-grow app-info">
            <b>{{ a.name }}</b>
            <div class="yh-muted small">{{ a.description }}</div>
            <div v-if="note(a)" class="small app-note" :class="note(a).bad ? 'bad' : 'yh-muted'">
              {{ note(a).text }}
              <el-button v-if="note(a).bad" link type="primary" size="small" @click="$router.push('/admin?tab=apps')">看日志</el-button>
            </div>
          </div>
          <el-tag v-if="a.state === 'RUNNING'" type="success" class="app-action">已在运行</el-tag>
          <el-tag v-else-if="a.state === 'NOT_RUNNING'" type="warning" class="app-action">未运行</el-tag>
          <el-tag v-else-if="a.state === 'CONFLICT'" type="danger" class="app-action">代码被占用</el-tag>
          <el-button v-else-if="a.state === 'INSTALLING' || requesting[a.code]" size="small" disabled :loading="true" class="app-action">安装中…</el-button>
          <el-button v-else type="primary" size="small" class="app-action" @click="install(a)">{{ a.op?.status === 'FAILED' ? '重新安装' : '安装' }}</el-button>
        </div>
        <div v-if="failed" class="small bad">{{ failed }}</div>
        <div v-if="pollFailed" class="small bad">暂时连不上控制台，下面的进度可能不是最新的，正在重试…</div>
        <div class="f-help">安装要从 GitHub 拉代码、构建镜像，每个一般 2~5 分钟。可以一次点多个，会一个一个排队装；不用等，可以先去下一步。</div>
      </div>

      <div class="ob-section">
        <div class="ob-section-title">公司已经在用的系统</div>
        <div class="ob-tip">
          OA、CRM、ERP 等已有系统可以登记成「外部应用」放到工作台上，支持 OIDC 的还能统一登录；自己开发的应用从 Git 仓库安装。
          <div class="ob-btns go"><el-button @click="$router.push('/admin?tab=apps')">去管理 → 应用</el-button></div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import { onboardingApi } from '@/api/admin'

const emit = defineEmits(['changed'])
const OP_TEXT = { PENDING: '排队中，等 yh agent 领取…', RUNNING: '正在安装…', SUCCESS: '安装完成', FAILED: '安装失败' }
const data = ref(null)
const installing = ref('')
const requesting = ref({})
const failed = ref('')
let timer = null

const busy = a => a.op && ['PENDING', 'RUNNING'].includes(a.op.status)

/** 行下方的补充说明：安装进度、失败原因、被占用、登记了没跑起来 */
function note(a) {
  if (a.op?.status === 'FAILED') return { text: `安装失败：${a.op.message || a.op.error || '详情看管理 → 应用里的日志'}`, bad: true }
  if (a.op && OP_TEXT[a.op.status] && !busy(a)) return { text: OP_TEXT[a.op.status], bad: false }
  if (a.state === 'CONFLICT') return { text: `code ${a.code} 已被「${a.takenBy || '别的应用'}」占用，换个 code 或先停用那个应用`, bad: true }
  if (a.state === 'NOT_RUNNING') return { text: '登记了但没在运行（构建失败或健康检查没过），去管理 → 应用看日志', bad: true }
  return null
}

async function load() {
  clearTimeout(timer)
  const before = data.value?.apps.filter(a => a.installed).length || 0
  data.value = await onboardingApi.officialApps()
  if (data.value.apps.filter(a => a.installed).length !== before) emit('changed')
  if (data.value.apps.some(busy)) timer = setTimeout(load, 4000)
}
async function install(a) {
  installing.value = a.code
  requesting.value[a.code] = true
  try {
    await onboardingApi.installOfficial(a.code)
    await load()
  } catch (e) {
    failed.value = e?.message || '安装没能提交，稍后再试'
  } finally {
    requesting.value[a.code] = false
    installing.value = ''
  }
}

onMounted(load)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<style scoped>
@import '../onboarding.css';
.app-row { display: flex; align-items: center; gap: 12px; }
.app-icon { flex: none; }
.agent-warn { margin-bottom: 12px; }
.go { margin-top: 10px; }
.small { font-size: 12px; }
.bad { color: var(--yh-danger); }
</style>
