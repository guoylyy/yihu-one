<template>
  <!-- 平台自身的版本与升级。版本、最新版本由宿主机上的 yh 上报；升级由 yh agent 执行，这里只发起、看进度 -->
  <section v-if="info" class="pv" :class="{ hot: info.updateAvailable }">
    <div class="pv-main">
      <div class="pv-title">
        平台版本 <b>v{{ info.version }}</b>
        <span v-if="info.mode === 'git' && info.commit" class="ver">{{ info.commit }}</span>
        <el-tag v-if="info.updateAvailable" size="small" type="warning" effect="plain">有新版本 v{{ info.latest.version }}</el-tag>
      </div>
      <div class="pv-sub">{{ subText }}</div>
      <div v-if="info.mode === 'package' && info.checkError" class="pv-sub warn">检查更新没成功：{{ info.checkError }}</div>
      <div v-if="info.mode === 'package' && !agentOnline" class="pv-sub warn">yh agent 未连接，这里点不了：在服务器上执行 <code>yh upgrade</code>，或先 <code>yh autostart</code> 让 agent 常驻</div>
      <pre v-if="info.updateAvailable && info.latest.notes" class="pv-notes">{{ info.latest.notes }}</pre>
      <div v-for="p in packages" :key="p.id" class="pv-pkg">
        <span>已上传的更新包 <b>v{{ p.version }}</b></span>
        <span class="yh-muted">{{ (p.size / 1024).toFixed(0) }} KB · {{ p.uploadedBy?.name || '' }} {{ fromNow(p.createdAt) }}{{ p.signed ? ' · 带签名' : '' }}</span>
        <el-button link type="primary" :disabled="!agentOnline" @click="upgrade(p)">用它升级</el-button>
        <el-button link type="danger" @click="removePackage(p)">删除</el-button>
      </div>
    </div>
    <div v-if="info.mode === 'package'" class="pv-actions">
      <el-button v-if="info.updateAvailable" type="primary" :disabled="!agentOnline" @click="upgrade()">升级到 v{{ info.latest.version }}</el-button>
      <el-button v-if="info.hasSource" :loading="checking" :disabled="!agentOnline" @click="check">检查更新</el-button>
      <el-button :loading="uploading" @click="pickPackage">上传更新包</el-button>
    </div>
  </section>
  <section v-else class="pv">
    <div class="pv-sub">平台版本未知：宿主机上的 yh 还没上报。在服务器上执行 <code>yh autostart</code> 让 agent 常驻后，这里会显示版本和新版本提示</div>
  </section>

  <el-dialog v-model="run.visible" title="平台升级" width="640px" :close-on-click-modal="false" :close-on-press-escape="false" :show-close="done">
    <div class="run-state">
      <el-icon v-if="!done" class="is-loading" :size="18"><Loading /></el-icon>
      <span :class="{ 'ok-text': run.status === 'SUCCESS', 'bad-text': run.status === 'FAILED' }">{{ runText }}</span>
    </div>
    <div v-if="!done" class="pv-sub" style="margin-top: 8px">整个过程约需几分钟。可以关掉这个页面，升级照常进行，结果会记在「最近操作」和「最近发布」里。</div>
    <pre v-if="run.log" class="run-log">{{ run.log }}</pre>
    <template #footer>
      <el-button v-if="run.status === 'SUCCESS'" type="primary" @click="reload">刷新页面</el-button>
      <el-button v-else-if="done" @click="run.visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { platformApi } from '@/api/admin'
import { fromNow } from '@/utils/format'

const props = defineProps({
  // 概览接口里的 platform：{ info, agent, running }
  platform: { type: Object, required: true }
})
const emit = defineEmits(['changed'])

const info = computed(() => props.platform.info)
const agentOnline = computed(() => !!props.platform.agent?.online)
const subText = computed(() => {
  const i = info.value
  if (i.mode === 'git') return `从 Git 安装：跟踪 ${i.branch || 'release'} 分支，由 yh agent 自动更新`
  if (i.updateAvailable) return `${i.latest.date ? i.latest.date + ' 发布 · ' : ''}升级前自动备份平台文件和控制台数据库，新版本起不来自动回滚`
  if (!i.hasSource) return '没有配置更新地址（服务器 yh.env 里的 UPGRADE_URL）：拿到新版本的更新包后在这里上传'
  return i.latest?.checkedAt ? `已是最新 · ${fromNow(i.latest.checkedAt)}检查过` : '还没检查过更新'
})

// ---------- 上传的更新包（不能联网的机器） ----------
const packages = ref([])
const uploading = ref(false)
async function loadPackages() {
  if (info.value?.mode === 'package') packages.value = (await platformApi.packages().catch(() => [])) || []
}
function pickPackage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = '.gz,.tgz,.sig'
  input.onchange = async () => {
    const files = [...(input.files || [])]
    const pkg = files.find(f => /\.(tar\.gz|tgz)$/.test(f.name))
    const sigFile = files.find(f => f.name.endsWith('.sig'))
    if (!pkg) return ElMessage.warning('请选择更新包（yihu-one-<版本>.tar.gz）；有 .sig 签名文件的话一起选上')
    uploading.value = true
    try {
      const p = await platformApi.uploadPackage(pkg, sigFile ? (await sigFile.text()).trim() : undefined)
      await loadPackages()
      upgrade(p)
    } finally {
      uploading.value = false
    }
  }
  input.click()
}
async function removePackage(p) {
  await platformApi.removePackage(p.id)
  await loadPackages()
}

// ---------- 升级 / 检查更新：排一个运维操作，轮询到结束 ----------
const run = reactive({ visible: false, id: null, status: '', log: '', lost: false })
const checking = ref(false)
const done = computed(() => run.status === 'SUCCESS' || run.status === 'FAILED')
const runText = computed(() => {
  if (run.status === 'SUCCESS') return '升级完成。刷新页面后用的就是新版本'
  if (run.status === 'FAILED') return '升级没有成功，平台已回到原来的版本（原因见下面的日志）'
  if (run.lost) return '控制台正在重新构建、重启，稍等…'
  if (run.status === 'PENDING') return '等待 yh agent 开始执行…'
  return '正在升级：备份 → 安装新版本 → 重新构建控制台'
})
let timer = null
let alive = true

async function upgrade(pkg) {
  const target = pkg ? pkg.version : info.value.latest.version
  const notes = pkg ? pkg.notes : ''
  try {
    await ElMessageBox.confirm(
      `把平台从 v${info.value.version} 升级到 v${target}。${notes ? '\n\n' + notes + '\n' : ''}\n升级前会备份平台文件和控制台数据库；重新构建控制台期间，控制台有几分钟打不开，各应用照常运行；新版本起不来会自动回滚。`,
      '升级平台', { confirmButtonText: '开始升级', cancelButtonText: '先不升', type: 'warning', customStyle: { whiteSpace: 'pre-wrap' } }
    )
  } catch { return }
  const op = await platformApi.request('UPGRADE', 'platform', pkg ? { packageId: pkg.id } : undefined)
  track(op.id)
}

function track(id) {
  Object.assign(run, { visible: true, id, status: 'PENDING', log: '', lost: false })
  poll()
}
async function poll() {
  clearTimeout(timer)
  try {
    const o = await platformApi.op(run.id)
    Object.assign(run, { status: o.status, log: o.log || '', lost: false })
  } catch {
    run.lost = true // 控制台重启中，接口暂时不通
  }
  if (done.value) { emit('changed'); loadPackages(); return }
  if (alive) timer = setTimeout(poll, 3000)
}
const reload = () => window.location.reload()

async function check() {
  checking.value = true
  try {
    const op = await platformApi.request('UPGRADE_CHECK', 'platform')
    for (let i = 0; i < 40 && alive; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const o = await platformApi.op(op.id).catch(() => null)
      if (!o || (o.status !== 'SUCCESS' && o.status !== 'FAILED')) continue
      const last = (o.log || '').trim().split('\n').pop() || ''
      if (o.status === 'SUCCESS') ElMessage.success(last || '检查完成')
      else ElMessage.error(last || '检查更新失败')
      emit('changed')
      return
    }
    ElMessage.warning('yh agent 还没执行完，稍后刷新看结果')
  } finally {
    checking.value = false
  }
}

onMounted(() => {
  loadPackages()
  // 刷新页面时升级还在进行：接着看进度
  const r = props.platform.running
  if (r?.kind === 'UPGRADE') { track(r.id); run.status = 'RUNNING' }
})
onBeforeUnmount(() => { alive = false; clearTimeout(timer) })
</script>

<style scoped>
.pv {
  display: flex; align-items: flex-start; gap: 16px; border: 1px solid var(--yh-border-soft); border-radius: 12px;
  padding: 12px 14px; margin-bottom: 12px; background: var(--yh-card);
}
.pv.hot { background: #fffbeb; border-color: #fef3c7; }
.pv-main { flex: 1; min-width: 0; }
.pv-title { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.pv-title b { font-weight: 600; }
.pv-sub { font-size: 12px; color: var(--yh-text-2); margin-top: 4px; line-height: 1.6; }
.pv-sub.warn { color: var(--yh-warning); }
.pv-sub code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; background: var(--yh-fill-2); padding: 0 4px; border-radius: 4px; color: var(--yh-text-2); }
.pv-notes {
  margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; background: rgba(255, 255, 255, .7); border: 1px solid var(--yh-border-soft);
  font-family: inherit; font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto;
}
.pv-pkg { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; margin-top: 8px; }
.pv-actions { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.pv-actions .el-button + .el-button { margin-left: 0; }
.ver { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--yh-text-3); background: var(--yh-fill-2); padding: 0 5px; border-radius: 4px; }
.run-state { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.ok-text { color: var(--yh-success); }
.bad-text { color: var(--yh-danger); }
.run-log {
  margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: #0f172a; color: #e2e8f0; font-size: 12px; line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; max-height: 320px; overflow: auto;
}
@media (max-width: 900px) {
  .pv { flex-direction: column; }
  .pv-actions { justify-content: flex-start; }
}
</style>
