<template>
  <div class="ob-form">
    <div class="yh-muted now">现在平台上有 <b>{{ status.facts.people }}</b> 个人。</div>

    <el-tabs v-model="tab">
      <el-tab-pane v-if="syncable.length" label="从通讯录同步" name="sync">
        <div class="ob-tip">把{{ syncable.map(s => s.label).join(' / ') }}的部门和人员同步过来：部门负责人、手机号一起带上；已经有的人按手机号或账号对上，不会重复建。以后可以在「管理 → 用户与部门」里再同步。</div>
        <div class="ob-btns sync-btns">
          <el-button v-for="s in syncable" :key="s.key" :loading="syncing === s.key" @click="preview(s.key)">预览{{ s.label }}通讯录</el-button>
        </div>
        <div v-if="syncResult" class="ob-box result">
          <div>{{ syncResult.message }}</div>
          <el-button v-if="syncResult.dryRun" type="primary" size="small" class="go" :loading="syncing === syncResult.provider" @click="runSync(syncResult.provider)">确认同步</el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane label="表格导入" name="table">
        <div class="ob-tip">
          <ol>
            <li>下载 <a href="javascript:;" @click="template">导入模板</a>，在 Excel 里填好：只有「姓名」必填；部门写成 <code>研发部/前端组</code>，没有的部门会自动建；「部门负责人」「管理员」填「是」</li>
            <li>上传 .xlsx 或 CSV 文件，或者直接从 Excel 里选中复制、粘贴到下面</li>
            <li>先预览，确认无误再导入。已存在的人（同账号或同手机号）跳过</li>
          </ol>
        </div>
        <div class="ob-btns">
          <el-button @click="pickFile">选择文件</el-button>
          <span v-if="fileName" class="yh-muted small">{{ fileName }}</span>
        </div>
        <el-input v-model="pasted" type="textarea" :rows="5" class="paste" placeholder="或者粘贴：第一行是表头（姓名、账号、手机号、邮箱、部门、职位、工号、部门负责人、管理员）" @input="table = null" />
        <el-form label-position="top" class="pw">
          <el-form-item label="初始密码（给填了账号的人）">
            <el-input v-model="password" type="password" show-password autocomplete="new-password" placeholder="至少 8 位，含字母和数字；只用钉钉 / 飞书登录的可以不填" style="max-width: 360px" />
          </el-form-item>
        </el-form>
        <div class="ob-btns">
          <el-button :loading="importing" @click="runImport(true)">预览</el-button>
          <el-button v-if="imported?.dryRun && imported.summary.new" type="primary" :loading="importing" @click="runImport(false)">导入 {{ imported.summary.new }} 人</el-button>
        </div>
        <div v-if="imported" class="ob-box result">
          <template v-if="imported.dryRun">
            共 {{ imported.summary.total }} 行：新增 <b>{{ imported.summary.new }}</b> 人，已存在 {{ imported.summary.exists }} 人，涉及 {{ imported.summary.depts }} 个部门路径
            <span v-if="imported.summary.errors.length" class="bad">，{{ imported.summary.errors.length }} 行有问题</span>
            <el-table :data="imported.rows" size="small" max-height="280" class="tbl">
              <el-table-column prop="line" label="行" width="50" />
              <el-table-column prop="name" label="姓名" width="100" />
              <el-table-column prop="username" label="账号" width="110" />
              <el-table-column prop="mobile" label="手机号" width="120" />
              <el-table-column label="部门" min-width="140"><template #default="{ row }">{{ row.dept.join(' / ') }}</template></el-table-column>
              <el-table-column label="" width="140">
                <template #default="{ row }">
                  <el-tag v-if="row.leader" size="small">负责人</el-tag>
                  <el-tag v-if="row.admin" size="small" type="warning">管理员</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="150">
                <template #default="{ row }">
                  <span :class="{ bad: row.status === 'error' }">{{ row.status === 'new' ? '新增' : row.status === 'exists' ? '已存在，跳过' : row.error }}</span>
                </template>
              </el-table-column>
            </el-table>
            <div v-if="imported.summary.total > imported.rows.length" class="f-help">只显示前 {{ imported.rows.length }} 行</div>
          </template>
          <template v-else>
            已导入 <b>{{ imported.summary.created }}</b> 人
            <div v-for="f in imported.summary.failed" :key="f.line" class="bad small">第 {{ f.line }} 行 {{ f.name }}：{{ f.error }}</div>
          </template>
        </div>
      </el-tab-pane>

      <el-tab-pane label="手动添加" name="manual">
        <div class="ob-tip">
          人不多的话，在「管理 → 用户与部门」里一个个加：建部门、加人、设部门负责人和管理员。
          <div class="ob-btns go"><el-button @click="$router.push('/admin?tab=users')">去用户与部门</el-button></div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div class="f-help">部门负责人和管理员默认能看到「老板助理」和「管理层」首页。</div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { onboardingApi } from '@/api/admin'
import { orgApi } from '@/api/org'
import { readTableFile, parseDelimited, downloadCsv } from '@/utils/table'

const props = defineProps({ status: { type: Object, required: true } })
const emit = defineEmits(['changed'])

const syncable = computed(() => [
  props.status.facts.im.dingtalk && { key: 'dingtalk', label: '钉钉' },
  props.status.facts.im.feishu && { key: 'feishu', label: '飞书' }
].filter(Boolean))
const tab = ref(syncable.value.length ? 'sync' : 'table')

const syncing = ref('')
const syncResult = ref(null)
const runOrg = (provider, dryRun) => (provider === 'feishu' ? orgApi.syncFeishu(dryRun) : orgApi.sync(dryRun))
async function preview(provider) {
  syncing.value = provider
  try { syncResult.value = { ...(await runOrg(provider, true)), provider } } finally { syncing.value = '' }
}
async function runSync(provider) {
  syncing.value = provider
  try {
    syncResult.value = { ...(await runOrg(provider, false)), provider }
    ElMessage.success('同步完成')
    emit('changed')
  } finally {
    syncing.value = ''
  }
}

const HEAD = ['姓名', '账号', '手机号', '邮箱', '部门', '职位', '工号', '部门负责人', '管理员']
function template() {
  downloadCsv('人员导入模板.csv', [HEAD, ['张三', 'zhangsan', '13800000001', 'zhangsan@example.com', '总经办', '总经理', 'A001', '是', '是'], ['李四', '', '13800000002', '', '研发部/前端组', '工程师', 'A002', '', '']])
}

const table = ref(null)
const fileName = ref('')
const pasted = ref('')
const password = ref('')
const importing = ref(false)
const imported = ref(null)

function pickFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xlsx,.csv,.txt'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      table.value = await readTableFile(file)
      fileName.value = `${file.name}（${Math.max(0, table.value.length - 1)} 行）`
      pasted.value = ''
      imported.value = null
      runImport(true)
    } catch (e) {
      ElMessage.error(e.message)
    }
  }
  input.click()
}

async function runImport(dryRun) {
  const t = table.value || (pasted.value.trim() ? parseDelimited(pasted.value) : null)
  if (!t) return ElMessage.warning('先选择文件或粘贴表格')
  if (!dryRun) {
    try {
      await ElMessageBox.confirm(`导入 ${imported.value.summary.new} 人${password.value ? '，填了账号的人用这个初始密码登录' : ''}？`, '确认导入', { type: 'info' })
    } catch { return }
  }
  importing.value = true
  try {
    imported.value = await onboardingApi.importPeople({ table: t, dryRun, password: password.value })
    if (!dryRun) emit('changed')
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
@import '../onboarding.css';
.ob-form { max-width: 900px; }
.now { margin-bottom: 6px; font-size: 13px; }
.sync-btns, .go { margin-top: 12px; }
.result { margin-top: 12px; font-size: 13px; line-height: 1.8; }
.paste { margin-top: 10px; }
.pw { margin-top: 12px; }
.tbl { margin-top: 8px; }
.bad { color: var(--yh-danger); }
.small { font-size: 12px; }
</style>
