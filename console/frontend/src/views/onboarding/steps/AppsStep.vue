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
          <span class="app-icon">{{ a.icon }}</span>
          <div class="yh-grow">
            <b>{{ a.name }}</b>
            <div class="yh-muted small">{{ a.description }}</div>
            <div v-if="a.op && !a.installed" class="small" :class="a.op.status === 'FAILED' ? 'bad' : 'yh-muted'">
              {{ OP_TEXT[a.op.status] || a.op.status }}
              <el-button v-if="a.op.status === 'FAILED'" link type="primary" size="small" @click="$router.push('/admin?tab=apps')">看日志</el-button>
            </div>
          </div>
          <el-tag v-if="a.installed" type="success">已安装</el-tag>
          <el-button v-else-if="!busy(a)" type="primary" size="small" :loading="installing === a.code" @click="install(a)">{{ a.op?.status === 'FAILED' ? '重新安装' : '安装' }}</el-button>
          <el-tag v-else type="info"><el-icon class="is-loading"><Loading /></el-icon> 安装中</el-tag>
        </div>
        <div class="f-help">安装要从 GitHub 拉代码、构建镜像，一般 2~5 分钟，可以先去下一步。</div>
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
import { onboardingApi } from '@/api/admin'

const emit = defineEmits(['changed'])
const OP_TEXT = { PENDING: '排队中，等 yh agent 领取…', RUNNING: '正在安装…', SUCCESS: '安装完成', FAILED: '安装失败' }
const data = ref(null)
const installing = ref('')
let timer = null

const busy = a => a.op && ['PENDING', 'RUNNING'].includes(a.op.status)

async function load() {
  clearTimeout(timer)
  const before = data.value?.apps.filter(a => a.installed).length || 0
  data.value = await onboardingApi.officialApps()
  if (data.value.apps.filter(a => a.installed).length !== before) emit('changed')
  if (data.value.apps.some(busy)) timer = setTimeout(load, 4000)
}
async function install(a) {
  installing.value = a.code
  try {
    await onboardingApi.installOfficial(a.code)
    await load()
  } finally {
    installing.value = ''
  }
}

onMounted(load)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<style scoped>
@import '../onboarding.css';
.app-row { display: flex; align-items: center; gap: 12px; }
.app-icon { font-size: 26px; width: 40px; text-align: center; }
.agent-warn { margin-bottom: 12px; }
.go { margin-top: 10px; }
.small { font-size: 12px; }
.bad { color: var(--yh-danger); }
</style>
