<template>
  <div class="yh-page me">
    <!-- 个人信息 -->
    <div class="yh-card profile">
      <UserAvatar :user="me" :size="64" />
      <div class="yh-grow">
        <div class="name">{{ me?.name }}<el-button link type="primary" :icon="EditPen" class="edit-name" title="修改姓名" @click="openName" /><span v-if="me?.username" class="yh-muted job">账号 {{ me.username }}</span><span v-if="me?.jobNumber" class="yh-muted job">工号 {{ me.jobNumber }}</span></div>
        <div class="line">{{ (me?.depts || []).map(d => d.name + (d.isPrimary && me.depts.length > 1 ? '（主）' : '')).join('、') || '—' }}<template v-if="me?.title"> · {{ me.title }}</template></div>
        <div class="tags">
          <el-tag v-for="r in (me?.roles || []).filter(r => r !== 'MEMBER')" :key="r" size="small" type="danger">{{ ROLE_LABEL[r] || r }}</el-tag>
          <el-tag v-if="me?.leaderOf?.length" size="small" type="success">部门负责人</el-tag>
        </div>
      </div>
      <el-button v-if="me?.username" plain @click="pw.visible = true">{{ me?.hasPassword ? '修改密码' : '设置密码' }}</el-button>
      <el-button v-if="isMobile" plain @click="logout">退出登录</el-button>
    </div>

    <el-dialog v-model="nameDlg.visible" title="修改姓名" width="400px">
      <el-input v-model="nameDlg.name" maxlength="50" show-word-limit placeholder="平台和各应用里显示的名字" @keydown.enter="saveName" />
      <div v-if="me?.dingBound" class="yh-muted small" style="margin-top: 8px">管理员从钉钉同步通讯录时，会以钉钉里的姓名为准</div>
      <template #footer>
        <el-button @click="nameDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="nameDlg.saving" :disabled="!nameDlg.name.trim()" @click="saveName">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pw.visible" :title="me?.hasPassword ? '修改密码' : '设置密码'" width="420px" @closed="Object.assign(pw, { old: '', next: '', again: '' })">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item v-if="me?.hasPassword" label="原密码"><el-input v-model="pw.old" type="password" show-password autocomplete="current-password" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="pw.next" type="password" show-password autocomplete="new-password" placeholder="至少 8 位，含字母和数字" /></el-form-item>
        <el-form-item label="再输一次"><el-input v-model="pw.again" type="password" show-password autocomplete="new-password" @keydown.enter="savePw" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pw.visible = false">取消</el-button>
        <el-button type="primary" :loading="pw.saving" @click="savePw">保存</el-button>
      </template>
    </el-dialog>

    <!-- API Key -->
    <div class="yh-card">
      <div class="yh-card-header">
        <div>
          <div class="yh-card-title">我的 API Key</div>
          <div class="yh-muted small">用于让外部智能体（Claude、Cursor、Cherry Studio 等）通过 MCP 以你的身份使用平台上各个应用的能力。请勿泄露。</div>
        </div>
        <el-button type="primary" :icon="Plus" @click="createKey">创建</el-button>
      </div>
      <el-table v-loading="keysLoading" :data="keys" empty-text="还没有 API Key">
        <el-table-column label="名称" prop="name" min-width="140" />
        <el-table-column label="Key" min-width="160"><template #default="{ row }"><code class="mono">{{ row.prefix }}••••••••</code></template></el-table-column>
        <el-table-column label="接入的 Agent" min-width="150"><template #default="{ row }"><span v-if="row.agentName">{{ row.agentName }}</span><span v-else class="yh-muted">{{ row.lastUsedAt ? '未识别' : '还没接入' }}</span></template></el-table-column>
        <el-table-column label="最近使用" min-width="120"><template #default="{ row }">{{ row.lastUsedAt ? fromNow(row.lastUsedAt) : '从未使用' }}</template></el-table-column>
        <el-table-column label="创建时间" min-width="140"><template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }"><el-button link type="danger" @click="revoke(row)">吊销</el-button></template>
        </el-table-column>
      </el-table>
    </div>

    <!-- MCP -->
    <div class="yh-card" v-loading="mcpLoading">
      <div class="yh-card-header">
        <div>
          <div class="yh-card-title"><span class="mcp-badge">MCP</span> 接入说明</div>
          <div class="yh-muted small">把{{ appCfg.workspaceName }}接入你自己的 AI 客户端，权限与网页端完全一致，写操作同样留痕。</div>
        </div>
      </div>
      <template v-if="mcp">
        <div class="kv">
          <div class="k">端点</div>
          <div class="v code-row"><code class="mono">{{ mcp.url }}</code><el-button size="small" @click="copy(mcp.url)">复制</el-button></div>
          <div class="k">鉴权</div>
          <div class="v"><code class="mono">Authorization: Bearer &lt;你的 API Key&gt;</code></div>
          <div class="k">传输</div>
          <div class="v">Streamable HTTP（无状态）</div>
        </div>

        <div class="sub-title">Claude Code（一条命令）</div>
        <div class="code-block">
          <el-button size="small" class="copy-btn" @click="copy(mcp.claudeCode)">复制</el-button>
          <pre>{{ mcp.claudeCode }}</pre>
        </div>

        <div class="sub-title">其他 Agent（Codex、Cursor、Cherry Studio 等）<span class="yh-muted small">按它的文档添加一个 Streamable HTTP 的 MCP，地址和请求头如下</span></div>
        <div class="code-block">
          <el-button size="small" class="copy-btn" @click="copy(mcp.configExample)">复制</el-button>
          <pre>{{ mcp.configExample }}</pre>
        </div>

        <div class="sub-title">可用工具 <span class="yh-muted">{{ mcp.tools?.length || 0 }}</span></div>
        <div class="tools">
          <div v-for="t in mcp.tools || []" :key="t.name" class="tool">
            <div class="yh-flex">
              <code class="mono tname">{{ t.name }}</code>
              <el-tag v-if="t.write" size="small" type="warning" effect="plain">写操作</el-tag>
              <el-tag v-else size="small" type="info" effect="plain">只读</el-tag>
            </div>
            <div class="tdesc">{{ t.description }}</div>
          </div>
        </div>
      </template>
    </div>

    <!-- 新 Key -->
    <el-dialog v-model="newKey.visible" title="API Key 已创建" width="520px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon title="这是唯一一次显示完整 Key，请立即复制保存。关闭后无法再次查看。" />
      <div class="code-row key-row"><code class="mono">{{ newKey.key }}</code><el-button type="primary" size="small" @click="copy(newKey.key)">复制</el-button></div>
      <template #footer><el-button type="primary" @click="newKey.visible = false">我已保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, EditPen } from '@element-plus/icons-vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { meApi } from '@/api/me'
import { useUserStore } from '@/stores/user'
import { useAppStore } from '@/stores/app'
import { useAssistantStore } from '@/stores/assistant'
import { ROLE_LABEL } from '@/utils/constants'
import { formatDateTime, fromNow, copyText } from '@/utils/format'
import { useMobile } from '@/utils/useMobile'

const router = useRouter()
const user = useUserStore()
const appCfg = useAppStore()
const assistant = useAssistantStore()
const isMobile = useMobile()
const me = computed(() => user.me)

const keys = ref([])
const keysLoading = ref(false)
const mcp = ref(null)
const mcpLoading = ref(false)
const newKey = reactive({ visible: false, key: '' })
const pw = reactive({ visible: false, old: '', next: '', again: '', saving: false })
const nameDlg = reactive({ visible: false, name: '', saving: false })

function openName() {
  nameDlg.name = me.value?.name || ''
  nameDlg.visible = true
}
async function saveName() {
  const name = nameDlg.name.trim()
  if (!name || nameDlg.saving) return
  if (name === me.value?.name) { nameDlg.visible = false; return }
  nameDlg.saving = true
  try {
    user.me = await meApi.updateProfile({ name })
    ElMessage.success('姓名已更新')
    nameDlg.visible = false
  } finally {
    nameDlg.saving = false
  }
}

async function savePw() {
  if (pw.next !== pw.again) return ElMessage.warning('两次输入的新密码不一致')
  pw.saving = true
  try {
    await meApi.changePassword(pw.old, pw.next)
    ElMessage.success('密码已更新')
    pw.visible = false
    user.fetchMe()
  } finally {
    pw.saving = false
  }
}

async function loadKeys() {
  keysLoading.value = true
  try {
    keys.value = (await meApi.apiKeys()) || []
  } finally {
    keysLoading.value = false
  }
}

async function loadMcp() {
  mcpLoading.value = true
  try {
    mcp.value = await meApi.mcpInfo()
  } finally {
    mcpLoading.value = false
  }
}

async function createKey() {
  let name
  try {
    const r = await ElMessageBox.prompt('给这个 Key 起个名字，方便以后辨认', '创建 API Key', {
      inputPlaceholder: '如：我的 Claude Desktop',
      inputValidator: v => (!!v && !!v.trim()) || '请填写名称',
      confirmButtonText: '创建',
      cancelButtonText: '取消'
    })
    name = r.value.trim()
  } catch {
    return
  }
  const res = await meApi.createApiKey(name)
  newKey.key = res.key
  newKey.visible = true
  loadKeys()
}

async function revoke(row) {
  try {
    await ElMessageBox.confirm(`吊销「${row.name}」？使用该 Key 的客户端将立即无法访问。`, '吊销 API Key', { type: 'warning', confirmButtonText: '吊销', cancelButtonText: '取消' })
  } catch {
    return
  }
  await meApi.revokeApiKey(row.id)
  ElMessage.success('已吊销')
  loadKeys()
}

async function copy(text) {
  if (await copyText(text || '')) ElMessage.success('已复制')
  else ElMessage.error('复制失败，请手动复制')
}

async function logout() {
  try {
    await ElMessageBox.confirm('确定退出登录吗？', '退出', { type: 'warning' })
  } catch {
    return
  }
  assistant.$reset()
  user.logout()
  router.replace('/login')
}

onMounted(() => {
  user.fetchMe().catch(() => {})
  loadKeys()
  loadMcp()
})
</script>

<style scoped>
.me { max-width: 1000px; }
.profile { display: flex; align-items: center; gap: 18px; }
.name { font-size: 20px; font-weight: 600; }
.job { font-size: 13px; font-weight: 400; margin-left: 10px; }
.line { color: var(--yh-text-2); margin-top: 4px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.small { font-size: 12px; margin-top: 4px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.mcp-badge { font-size: 11px; background: #ecfeff; color: #0e7490; border: 1px solid #a5f3fc; border-radius: 4px; padding: 0 6px; }
.kv { display: grid; grid-template-columns: 60px 1fr; gap: 10px 12px; align-items: center; font-size: 13px; }
.kv .k { color: var(--yh-text-3); }
.code-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.code-row code { flex: 1; min-width: 0; background: var(--yh-fill-2); padding: 6px 10px; border-radius: 6px; word-break: break-all; user-select: all; }
.key-row { margin-top: 16px; }
.sub-title { font-weight: 600; margin: 20px 0 8px; font-size: 14px; }
.edit-name { margin-left: 6px; font-size: 15px; vertical-align: 1px; }
.code-block { position: relative; }
.code-block pre { margin: 0; background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 10px; overflow-x: auto; font-size: 12.5px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.copy-btn { position: absolute; top: 8px; right: 8px; }
.tools { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.tool { border: 1px solid var(--yh-border-soft); border-radius: 10px; padding: 10px 12px; }
.tname { color: var(--yh-primary-dark); }
.tdesc { font-size: 12.5px; color: var(--yh-text-2); margin-top: 4px; line-height: 1.6; }
@media (max-width: 767px) {
  .profile { flex-wrap: wrap; }
  .kv { grid-template-columns: 1fr; gap: 4px; }
  .kv .k { margin-top: 6px; }
}
</style>
