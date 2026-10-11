<template>
  <div class="yh-page studio">
    <div class="yh-page-header">
      <div>
        <h2 class="yh-page-title">创作中心</h2>
        <div class="yh-page-sub">做一个 AI 助手或小工具给自己和同事用。仅自己用或分享给同事马上生效；上架到全公司市场需要管理员审核</div>
      </div>
      <div class="yh-flex">
        <el-button @click="agentDlg = true">让 Agent 帮我发布</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate()">新建应用</el-button>
      </div>
    </div>

    <!-- 还没做过：直接给四个入口 -->
    <div v-if="!loading && !apps.length" class="kinds big">
      <div v-for="k in kindList" :key="k.value" class="kind-card" :class="{ disabled: k.disabled }" @click="!k.disabled && openCreate(k.value)">
        <div class="k-icon" :style="{ background: k.color + '14', color: k.color }">{{ k.icon }}</div>
        <div class="k-name">{{ k.label }}</div>
        <div class="k-desc">{{ k.desc }}</div>
        <div v-if="k.disabled" class="k-lock">需要开发者角色</div>
      </div>
    </div>

    <div v-else v-loading="loading" class="list">
      <div v-for="a in apps" :key="a.id" class="yh-card item" @click="$router.push(`/studio/${a.id}`)">
        <AppIcon :icon="a.icon" :name="a.name" :color="a.iconColor" :size="44" />
        <div class="yh-grow" style="min-width: 0">
          <div class="name">
            <span class="yh-ellipsis">{{ a.name }}</span>
            <span class="kind" :style="{ color: APP_KIND[a.kind].color }">{{ APP_KIND[a.kind].label }}</span>
          </div>
          <div class="desc yh-ellipsis">{{ a.description || '还没写简介' }}</div>
          <div v-if="a.adminNote" class="note">{{ a.adminNote }}</div>
          <div v-else-if="a.idle" class="idle">近 30 天没人用过，不需要了可以删掉或改成仅自己</div>
        </div>
        <div class="state">
          <el-tag v-if="a.liveVersionId || a.managed" size="small" :type="APP_SCOPE[a.scope].type">{{ APP_SCOPE[a.scope].label }}</el-tag>
          <el-tag v-else size="small" type="info">未发布</el-tag>
          <el-tag v-if="a.latest && ['PENDING', 'REJECTED'].includes(a.latest.status)" size="small" :type="VERSION_STATUS[a.latest.status].type">{{ VERSION_STATUS[a.latest.status].label }}</el-tag>
          <div class="yh-muted small">{{ a.installs }} 人添加 · 近 30 天 {{ a.users30 }} 人用过 · {{ fromNow(a.updatedAt) }}更新</div>
        </div>
      </div>
    </div>

    <el-dialog v-model="dlg.visible" title="新建应用" width="620px">
      <div class="kinds">
        <div v-for="k in kindList" :key="k.value" class="kind-card small" :class="{ active: dlg.form.kind === k.value, disabled: k.disabled }" @click="!k.disabled && (dlg.form.kind = k.value)">
          <div class="k-icon" :style="{ background: k.color + '14', color: k.color }">{{ k.icon }}</div>
          <div>
            <div class="k-name">{{ k.label }}</div>
            <div class="k-desc">{{ k.disabled ? '需要开发者角色' : k.desc }}</div>
          </div>
        </div>
      </div>
      <el-form ref="formRef" :model="dlg.form" :rules="rules" label-width="72px" style="margin-top: 18px">
        <el-form-item label="名称" prop="name"><el-input v-model="dlg.form.name" maxlength="60" placeholder="如：报销小助手、会议室预约" /></el-form-item>
        <el-form-item v-if="needCode" label="code" prop="code">
          <el-input v-model="dlg.form.code" placeholder="英文唯一标识，如 crm" />
          <div class="yh-muted small">{{ dlg.form.kind === 'HOSTED' ? '和仓库里 yh-app.json 的 code 一致；应用地址是 /apps/<code>/' : '统一认证的 client_id' }}</div>
        </el-form-item>
        <el-form-item label="简介"><el-input v-model="dlg.form.description" maxlength="200" placeholder="一句话说清楚它能帮人做什么" /></el-form-item>
        <el-form-item label="图标">
          <IconPicker v-model:icon="dlg.form.icon" v-model:color="dlg.form.iconColor" :name="dlg.form.name" />
        </el-form-item>
        <el-form-item label="分类"><el-input v-model="dlg.form.category" maxlength="30" placeholder="如 财务 / 行政 / 销售 / 工具" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="create">创建并编辑</el-button>
      </template>
    </el-dialog>

    <!-- Agent 原生发布：一段指令粘给自己的 Agent，在项目文件夹里一句话发布 -->
    <el-dialog v-model="agentDlg" title="让 Agent 帮我发布" width="640px">
      <ol class="agent-steps">
        <li>先把平台接到你的 Agent（Claude Code、Codex 等）：在 <a class="yh-link" @click="$router.push('/me')">个人中心</a> 生成 API Key，按「MCP 接入说明」配置。只需要做一次</li>
        <li>在项目文件夹里打开 Agent，把下面这段话粘给它</li>
      </ol>
      <div class="agent-prompt">
        <el-button size="small" class="copy-btn" @click="copyPrompt">复制</el-button>
        <pre>{{ agentPrompt }}</pre>
      </div>
      <div class="yh-muted small">Agent 以你本人的身份发布，审核规则和在这里点「发布」完全一样；发完的应用也会出现在这个列表里。</div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import IconPicker from '@/components/IconPicker.vue'
import { studioApi } from '@/api/market'
import { useUserStore } from '@/stores/user'
import { APP_KIND, APP_SCOPE, VERSION_STATUS } from '@/utils/constants'
import { fromNow } from '@/utils/format'
import { ElMessage } from 'element-plus'

const agentDlg = ref(false)
const agentPrompt = [
  '请把当前文件夹里的项目发布到以虎 One（用已经接好的以虎 One MCP）：',
  '1. 先调用 list_my_published，看我能发布哪些类型、这个项目是不是已经发过（发过就更新它）。',
  '2. 判断类型：有 SKILL.md 的是 Skill → publish_skill；单个 HTML 页面的小工具 → publish_app kind=LITE（html 传完整文件）；有 Dockerfile 和 yh-app.json 的服务 → kind=HOSTED（先确认代码已推送到 Git，code 和 yh-app.json 一致）；已经部署在别处的系统 → kind=EXTERNAL。',
  '3. 名称、一句话简介、图标我没说的，根据项目给我 2～3 个建议让我选；code 先用 check_app_code 查能不能用。',
  '4. 发布前问我发给谁：仅自己 / 指定同事或部门 / 上架全公司（要管理员审核），并告诉我哪种需要审核。',
  '5. 发布后把访问地址告诉我；代码应用用 publish_status 跟进安装进度，失败的话用大白话说原因和怎么改。'
].join('\n')
async function copyPrompt() {
  await navigator.clipboard.writeText(agentPrompt)
  ElMessage.success('已复制，粘贴给你的 Agent')
}

const router = useRouter()
const user = useUserStore()
const apps = ref([])
const loading = ref(false)
const formRef = ref(null)
const dlg = reactive({ visible: false, saving: false, form: {} })

const kindList = computed(() => ['AGENT', 'LITE', 'SKILL', 'EXTERNAL', 'HOSTED'].map(k => ({
  value: k, ...APP_KIND[k], disabled: k === 'HOSTED' && !user.permissions.developer
})))
const needCode = computed(() => ['EXTERNAL', 'HOSTED'].includes(dlg.form.kind))
const rules = {
  name: [{ required: true, message: '请填写名称', trigger: 'blur' }],
  code: [
    { required: true, message: '请填写 code', trigger: 'blur' },
    { pattern: /^[a-z][a-z0-9-]{1,30}$/, message: '小写字母开头，只含小写字母、数字、短横线（2~31 位）', trigger: 'blur' }
  ]
}

async function load() {
  loading.value = true
  try {
    apps.value = (await studioApi.list()) || []
  } finally {
    loading.value = false
  }
}

function openCreate(kind = 'AGENT') {
  dlg.form = { kind, name: '', code: '', description: '', icon: '', iconColor: '', category: '' }
  dlg.visible = true
}

async function create() {
  try { await formRef.value.validate() } catch { return }
  dlg.saving = true
  try {
    const f = dlg.form
    const app = await studioApi.create({ ...f, code: needCode.value ? f.code : undefined })
    dlg.visible = false
    router.push(`/studio/${app.id}`)
  } finally {
    dlg.saving = false
  }
}

onMounted(load)
</script>

<style scoped>
.agent-steps { padding-left: 20px; line-height: 1.9; font-size: 13px; margin: 0 0 12px; }
.agent-prompt { position: relative; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; }
.agent-prompt pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.7; }
.agent-prompt .copy-btn { position: absolute; top: 8px; right: 8px; }
.kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.kinds.big { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.kind-card {
  background: var(--yh-card); border: 1px solid var(--yh-border-soft); border-radius: 14px; padding: 20px; cursor: pointer; transition: all .15s; position: relative;
}
.kind-card:hover { border-color: var(--el-color-primary-light-7); box-shadow: 0 6px 16px rgba(var(--yh-primary-rgb), .08); }
.kind-card.small { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; }
.kind-card.active { border-color: var(--yh-primary); background: var(--yh-primary-soft); }
.kind-card.disabled { opacity: .5; cursor: not-allowed; }
.k-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
.kinds.big .k-icon { margin-bottom: 12px; }
.k-name { font-weight: 600; font-size: 15px; }
.k-desc { font-size: 12.5px; color: var(--yh-text-2); margin-top: 4px; line-height: 1.6; }
.k-lock { position: absolute; top: 12px; right: 12px; font-size: 11px; color: var(--yh-text-3); }
.list { display: flex; flex-direction: column; gap: 10px; min-height: 120px; }
.item { display: flex; gap: 14px; align-items: center; cursor: pointer; transition: border-color .15s; }
.item:hover { border-color: var(--el-color-primary-light-7); }
.name { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; }
.kind { font-size: 12px; font-weight: 500; }
.desc { font-size: 13px; color: var(--yh-text-2); margin-top: 2px; }
.note { font-size: 12px; color: var(--yh-danger); margin-top: 4px; }
.idle { font-size: 12px; color: var(--yh-warning); margin-top: 4px; }
.state { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
.small { font-size: 12px; }
@media (max-width: 767px) {
  .kinds { grid-template-columns: 1fr; }
}
</style>
