<template>
  <div class="org">
    <div class="toolbar">
      <!-- 多个空间时：按空间看人和部门（不同空间的组织架构互不相干） -->
      <el-select v-if="multiSpace" v-model="spaceId" style="width: 160px" @change="onSpace">
        <el-option v-for="s in spaces" :key="s.id" :label="s.name" :value="s.id" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜索姓名 / 账号 / 工号 / 手机" clearable :prefix-icon="Search" class="kw" @change="reloadUsers" @clear="reloadUsers" />
      <el-checkbox v-model="showInactive" @change="reloadUsers">显示已停用</el-checkbox>
      <div class="yh-grow"></div>
      <el-button :icon="Refresh" :loading="syncing" @click="sync('dingtalk')">从钉钉同步</el-button>
      <el-button :icon="Refresh" :loading="syncing" @click="sync('feishu')">从飞书同步</el-button>
      <el-button type="primary" :icon="Plus" @click="openUser(null)">添加用户</el-button>
    </div>

    <div class="org-grid">
      <!-- 部门树 -->
      <div class="dept-pane">
        <div class="pane-head">
          <span class="pane-title">部门</span>
          <el-button link type="primary" size="small" :icon="Plus" @click="openDept(null)">新建</el-button>
        </div>
        <div class="dept-all" :class="{ active: !deptId }" @click="selectDept(null)">全部用户</div>
        <el-tree
          v-loading="loadingDept"
          :data="depts"
          node-key="id"
          :props="{ label: 'name', children: 'children' }"
          :expand-on-click-node="false"
          :current-node-key="deptId"
          highlight-current
          default-expand-all
          @node-click="d => selectDept(d.id)"
        >
          <template #default="{ data }">
            <div class="dept-node">
              <span class="yh-ellipsis">{{ data.name }}</span>
              <span class="yh-muted small">{{ data.memberCount ?? '' }}</span>
            </div>
          </template>
        </el-tree>
        <div v-if="!loadingDept && !depts.length" class="yh-muted small empty-dept">还没有部门。可以手动新建，或从钉钉 / 飞书同步</div>
      </div>

      <!-- 用户 -->
      <div class="user-pane">
        <div v-if="currentDept" class="dept-info">
          <div class="yh-flex">
            <b>{{ currentDept.name }}</b>
            <span class="yh-muted small">{{ currentDept.memberCount ?? 0 }} 人</span>
            <el-tag v-if="currentDept.dingDeptId" size="small" effect="plain" type="info">钉钉</el-tag>
            <el-tag v-if="currentDept.feishuDeptId" size="small" effect="plain" type="primary">飞书</el-tag>
          </div>
          <div class="yh-flex leaders">
            <span class="yh-muted">负责人：</span>
            <template v-if="currentDept.leaders?.length">
              <span v-for="l in currentDept.leaders" :key="l.id" class="yh-flex"><UserAvatar :user="l" :size="20" />{{ l.name }}</span>
            </template>
            <span v-else class="yh-muted">未设置</span>
            <el-button link type="primary" @click="openDept(currentDept)">编辑部门</el-button>
            <el-button link type="danger" @click="removeDept(currentDept)">删除</el-button>
          </div>
        </div>

        <el-table v-loading="loadingUsers" :data="users" size="default">
          <el-table-column label="姓名" min-width="150">
            <template #default="{ row }">
              <div class="yh-flex">
                <UserAvatar :user="row" :size="28" />
                <div style="min-width: 0">
                  <div class="yh-flex">{{ row.name }} <el-tag v-if="row.active === false" size="small" type="info">已停用</el-tag></div>
                  <div class="yh-muted small">{{ row.username || '—' }}<template v-if="row.jobNumber"> · {{ row.jobNumber }}</template></div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="部门" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ (row.depts || []).map(d => d.name).join('、') || '—' }}</template>
          </el-table-column>
          <el-table-column label="职位" prop="title" min-width="100" show-overflow-tooltip />
          <el-table-column label="登录方式" min-width="120">
            <template #default="{ row }">
              <el-tag v-if="row.hasPassword" size="small" effect="plain" class="mr4">密码</el-tag>
              <el-tag v-if="row.dingUserId" size="small" effect="plain" type="primary" class="mr4">钉钉</el-tag>
              <el-tag v-if="row.feishuBound" size="small" effect="plain" type="primary" class="mr4" :title="row.feishuOpenId">飞书</el-tag>
              <el-tag v-if="row.wecomBound" size="small" effect="plain" type="success" class="mr4" :title="row.wecomUserId">企业微信</el-tag>
              <span v-if="!row.hasPassword && !row.dingUserId && !row.feishuBound && !row.wecomBound" class="yh-danger-text small">无法登录</span>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.roles?.includes('ADMIN')" size="small" type="danger">管理员</el-tag>
              <el-tag v-else-if="row.roles?.includes('DEVELOPER')" size="small" type="warning">开发者</el-tag>
              <span v-else class="yh-muted">成员</span>
            </template>
          </el-table-column>
          <el-table-column label="最近登录" width="110">
            <template #default="{ row }"><span class="small yh-muted">{{ row.lastLoginAt ? fromNow(row.lastLoginAt) : '从未' }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openUser(row)">编辑</el-button>
              <el-button link type="primary" @click="openPw(row)">密码</el-button>
              <el-dropdown trigger="click" @command="c => more(row, c)">
                <el-button link type="primary">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item :command="row.active ? 'disable' : 'enable'">{{ row.active ? '停用' : '启用' }}</el-dropdown-item>
                    <el-dropdown-item command="delete" divided><span class="danger">删除</span></el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
        </el-table>
        <div class="pager">
          <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="total, prev, pager, next" size="small" @current-change="loadUsers" />
        </div>
      </div>
    </div>

    <!-- 用户 -->
    <el-dialog v-model="userDlg.visible" :title="userDlg.id ? `编辑：${userDlg.form.name}` : '添加用户'" width="540px">
      <el-form ref="userRef" :model="userDlg.form" :rules="userRules" label-width="84px">
        <el-form-item label="姓名" prop="name"><el-input v-model="userDlg.form.name" /></el-form-item>
        <el-form-item v-if="multiSpace" label="空间">
          <el-select v-model="userDlg.form.spaceId" style="width: 100%" @change="onUserSpace">
            <el-option v-for="s in spaces" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
          <div class="yh-muted small">换空间后，他在原来空间的部门会去掉，只能看到新空间的同事和应用</div>
        </el-form-item>
        <el-form-item label="登录账号" prop="username">
          <el-input v-model="userDlg.form.username" placeholder="字母开头，如 zhangsan；只用钉钉 / 飞书 / 企业微信登录可留空" />
        </el-form-item>
        <el-form-item v-if="!userDlg.id" label="初始密码" prop="password">
          <el-input v-model="userDlg.form.password" type="password" show-password autocomplete="new-password" placeholder="至少 8 位，含字母和数字；留空则不能用密码登录">
            <template #append><el-button @click="genPassword">生成</el-button></template>
          </el-input>
        </el-form-item>
        <el-form-item label="部门">
          <el-tree-select v-model="userDlg.form.deptIds" :data="userDlg.depts" :props="{ label: 'name', children: 'children', value: 'id' }" node-key="id" multiple check-strictly filterable clearable placeholder="第一个为主部门" style="width: 100%" />
        </el-form-item>
        <el-form-item label="职位"><el-input v-model="userDlg.form.title" /></el-form-item>
        <el-form-item label="工号"><el-input v-model="userDlg.form.jobNumber" /></el-form-item>
        <el-form-item label="手机"><el-input v-model="userDlg.form.mobile" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="userDlg.form.email" /></el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="userDlg.form.role">
            <el-radio value="MEMBER">成员</el-radio>
            <el-radio value="DEVELOPER">开发者</el-radio>
            <el-radio value="ADMIN">管理员</el-radio>
          </el-radio-group>
          <div class="yh-muted small full">开发者可以在创作中心提交代码应用（要审核）；管理员能进「管理」配置平台、审核应用、管理用户</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="userDlg.saving" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>

    <!-- 密码 -->
    <el-dialog v-model="pwDlg.visible" :title="`设置密码：${pwDlg.row?.name || ''}`" width="460px">
      <el-alert v-if="!pwDlg.row?.username" type="warning" :closable="false" show-icon title="该用户还没有登录账号，先在「编辑」里设置账号" />
      <template v-else>
        <div class="yh-muted small" style="margin-bottom: 10px">账号 <b>{{ pwDlg.row.username }}</b>。设置后把新密码告诉本人，建议登录后到「个人中心」自己修改。</div>
        <el-input v-model="pwDlg.password" type="password" show-password autocomplete="new-password" placeholder="新密码：至少 8 位，含字母和数字">
          <template #append><el-button @click="pwDlg.password = randomPassword(); pwDlg.show = true">生成</el-button></template>
        </el-input>
        <div v-if="pwDlg.show && pwDlg.password" class="gen">{{ pwDlg.password }} <el-button link type="primary" size="small" @click="copy(pwDlg.password)">复制</el-button></div>
      </template>
      <template #footer>
        <el-button v-if="pwDlg.row?.hasPassword && (pwDlg.row?.dingUserId || pwDlg.row?.feishuBound || pwDlg.row?.wecomBound)" type="danger" plain :loading="pwDlg.saving" @click="savePw(true)">取消密码登录</el-button>
        <el-button @click="pwDlg.visible = false">关闭</el-button>
        <el-button type="primary" :disabled="!pwDlg.row?.username || !pwDlg.password" :loading="pwDlg.saving" @click="savePw(false)">保存</el-button>
      </template>
    </el-dialog>

    <!-- 部门 -->
    <el-dialog v-model="deptDlg.visible" :title="deptDlg.id ? `编辑部门：${deptDlg.form.name}` : '新建部门'" width="480px">
      <el-form label-width="84px">
        <el-form-item label="名称"><el-input v-model="deptDlg.form.name" /></el-form-item>
        <el-form-item label="上级部门">
          <el-tree-select v-model="deptDlg.form.parentId" :data="depts" :props="{ label: 'name', children: 'children', value: 'id' }" node-key="id" check-strictly filterable clearable placeholder="不选为顶级部门" style="width: 100%" />
        </el-form-item>
        <el-form-item v-if="deptDlg.id" label="负责人">
          <UserSelect v-model="deptDlg.form.leaderIds" multiple :initial="deptDlg.leaders" placeholder="搜索并选择" />
          <div class="yh-muted small full">统一认证返回给应用的 leaderOf 据此推导，应用可以用它做审批、数据范围等</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deptDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="deptDlg.saving" @click="saveDept">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, ArrowDown } from '@element-plus/icons-vue'
import UserAvatar from '@/components/UserAvatar.vue'
import UserSelect from '@/components/UserSelect.vue'
import { orgApi } from '@/api/org'
import { adminApi } from '@/api/admin'
import { useUserStore } from '@/stores/user'
import { fromNow, copyText } from '@/utils/format'

const depts = ref([])
const loadingDept = ref(false)
const deptId = ref(null)
const users = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const keyword = ref('')
const showInactive = ref(false)
const loadingUsers = ref(false)
const syncing = ref(false)
// 空间：只有一个空间时不出现
const user = useUserStore()
const multiSpace = computed(() => !!user.me?.multiSpace)
const spaces = ref([])
const spaceId = ref(user.me?.space?.id || 1)
async function loadSpaces() {
  if (multiSpace.value) spaces.value = (await adminApi.spaces().catch(() => [])) || []
}
function onSpace() { deptId.value = null; loadDepts(); reloadUsers() }

function findDept(list, id) {
  for (const d of list || []) {
    if (d.id === id) return d
    const c = findDept(d.children, id)
    if (c) return c
  }
  return null
}
const currentDept = computed(() => (deptId.value ? findDept(depts.value, deptId.value) : null))

async function loadDepts() {
  loadingDept.value = true
  try {
    depts.value = (await orgApi.departments(multiSpace.value ? { spaceId: spaceId.value } : undefined)) || []
  } finally {
    loadingDept.value = false
  }
}
async function loadUsers() {
  loadingUsers.value = true
  try {
    const res = await orgApi.users({ keyword: keyword.value, deptId: deptId.value, page: page.value, pageSize, includeInactive: showInactive.value || undefined, spaceId: multiSpace.value ? spaceId.value : undefined })
    users.value = res?.list || []
    total.value = res?.total || 0
  } finally {
    loadingUsers.value = false
  }
}
function reloadUsers() { page.value = 1; loadUsers() }
function selectDept(id) { deptId.value = id; reloadUsers() }

// ---------- 用户 ----------
const randomPassword = () => {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'
  const d = '23456789'
  const pick = s => s[Math.floor(Math.random() * s.length)]
  return Array.from({ length: 8 }, () => pick(a)).join('') + pick(d) + pick(d) + pick(d)
}
const userRef = ref(null)
const userDlg = reactive({ visible: false, id: null, saving: false, form: {}, depts: [] })
/** 对话框里的部门选项跟着所选空间走 */
async function onUserSpace() {
  userDlg.form.deptIds = []
  userDlg.depts = (await orgApi.departments({ spaceId: userDlg.form.spaceId })) || []
}
const userRules = {
  name: [{ required: true, message: '请填写姓名', trigger: 'blur' }],
  username: [{ pattern: /^[a-zA-Z][a-zA-Z0-9_.-]{1,49}$/, message: '字母开头，只含字母、数字、_ . -', trigger: 'blur' }],
  password: [{ validator: (r, v, cb) => (!v || (v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v)) ? cb() : cb(new Error('至少 8 位，含字母和数字'))), trigger: 'blur' }]
}
function openUser(row) {
  userDlg.id = row?.id || null
  userDlg.form = {
    name: row?.name || '', username: row?.username || '', password: '',
    deptIds: row ? (row.depts || []).slice().sort((a, b) => b.isPrimary - a.isPrimary).map(d => d.id) : (deptId.value ? [deptId.value] : []),
    title: row?.title || '', jobNumber: row?.jobNumber || '', mobile: row?.mobile || '', email: row?.email || '',
    role: row?.roles?.includes('ADMIN') ? 'ADMIN' : row?.roles?.includes('DEVELOPER') ? 'DEVELOPER' : 'MEMBER',
    spaceId: row?.spaceId || spaceId.value
  }
  userDlg.depts = depts.value
  if (multiSpace.value && userDlg.form.spaceId !== spaceId.value) orgApi.departments({ spaceId: userDlg.form.spaceId }).then(d => { userDlg.depts = d || [] })
  userDlg.visible = true
}
function genPassword() {
  userDlg.form.password = randomPassword()
  ElMessageBox.alert(`初始密码：${userDlg.form.password}\n保存后请告诉本人。`, '已生成密码', { confirmButtonText: '知道了' })
}
async function saveUser() {
  try { await userRef.value.validate() } catch { return }
  const f = userDlg.form
  const body = {
    name: f.name, username: f.username || null, deptIds: f.deptIds, title: f.title, jobNumber: f.jobNumber,
    mobile: f.mobile, email: f.email, roles: [f.role], ...(multiSpace.value ? { spaceId: f.spaceId } : {})
  }
  userDlg.saving = true
  try {
    if (userDlg.id) await orgApi.updateUser(userDlg.id, body)
    else await orgApi.createUser({ ...body, password: f.password || undefined })
    ElMessage.success('已保存')
    userDlg.visible = false
    loadUsers()
    loadDepts()
  } finally {
    userDlg.saving = false
  }
}

const pwDlg = reactive({ visible: false, row: null, password: '', show: false, saving: false })
function openPw(row) {
  Object.assign(pwDlg, { visible: true, row, password: '', show: false })
}
async function savePw(clear) {
  pwDlg.saving = true
  try {
    await orgApi.setPassword(pwDlg.row.id, clear ? null : pwDlg.password)
    ElMessage.success(clear ? '已取消密码登录' : '密码已设置')
    pwDlg.visible = false
    loadUsers()
  } finally {
    pwDlg.saving = false
  }
}

async function more(row, cmd) {
  if (cmd === 'disable' || cmd === 'enable') {
    await orgApi.updateUser(row.id, { active: cmd === 'enable' })
    ElMessage.success(cmd === 'enable' ? '已启用' : '已停用')
    return loadUsers()
  }
  if (cmd === 'delete') {
    try {
      await ElMessageBox.confirm(`删除「${row.name}」？账号和个人 API Key 立即失效，操作记录保留。`, '删除用户', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' })
    } catch {
      return
    }
    await orgApi.removeUser(row.id)
    ElMessage.success('已删除')
    loadUsers()
    loadDepts()
  }
}

// ---------- 部门 ----------
const deptDlg = reactive({ visible: false, id: null, saving: false, form: {}, leaders: [] })
function openDept(d) {
  deptDlg.id = d?.id || null
  deptDlg.leaders = d?.leaders || []
  deptDlg.form = { name: d?.name || '', parentId: d ? d.parentId : deptId.value, leaderIds: (d?.leaders || []).map(l => l.id) }
  deptDlg.visible = true
}
async function saveDept() {
  if (!deptDlg.form.name.trim()) return ElMessage.warning('请填写部门名称')
  deptDlg.saving = true
  try {
    if (deptDlg.id) await orgApi.updateDepartment(deptDlg.id, { name: deptDlg.form.name, parentId: deptDlg.form.parentId || null, leaderIds: deptDlg.form.leaderIds })
    else await orgApi.createDepartment({ name: deptDlg.form.name, parentId: deptDlg.form.parentId || null, ...(multiSpace.value ? { spaceId: spaceId.value } : {}) })
    ElMessage.success('已保存')
    deptDlg.visible = false
    loadDepts()
  } finally {
    deptDlg.saving = false
  }
}
async function removeDept(d) {
  try {
    await ElMessageBox.confirm(`删除部门「${d.name}」？部门下不能还有成员或下级部门。`, '删除部门', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  await orgApi.removeDepartment(d.id)
  ElMessage.success('已删除')
  deptId.value = null
  loadDepts()
  reloadUsers()
}

const SYNC_LABEL = { dingtalk: '钉钉', feishu: '飞书' }
async function sync(provider) {
  syncing.value = true
  try {
    const target = multiSpace.value ? spaceId.value : undefined // 新同步进来的部门和人放进当前选的空间
    const run = dryRun => (provider === 'feishu' ? orgApi.syncFeishu(dryRun, target) : orgApi.sync(dryRun, target))
    const plan = await run(true)
    syncing.value = false
    try {
      await ElMessageBox.confirm(`${plan.message}\n\n确认按${SYNC_LABEL[provider]}通讯录同步？已设置的角色、账号密码会保留。`, `从${SYNC_LABEL[provider]}同步`, { type: 'info', confirmButtonText: '同步', cancelButtonText: '取消' })
    } catch {
      return
    }
    syncing.value = true
    const r = await run(false)
    ElMessage.success(r.message)
    loadDepts()
    reloadUsers()
  } finally {
    syncing.value = false
  }
}

async function copy(t) {
  if (await copyText(t)) ElMessage.success('已复制')
}

onMounted(async () => {
  await loadSpaces()
  loadDepts()
  loadUsers()
})
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.kw { max-width: 280px; }
.org-grid { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 16px; }
.dept-pane { border: 1px solid var(--yh-border-soft); border-radius: 10px; padding: 8px 6px 10px; max-height: 680px; overflow: auto; }
.pane-head { display: flex; align-items: center; justify-content: space-between; padding: 0 8px 6px; }
.pane-title { font-size: 12px; color: var(--yh-text-3); }
.dept-all { padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 14px; }
.dept-all.active { background: var(--yh-primary-soft); color: var(--yh-primary); }
.dept-node { display: flex; justify-content: space-between; width: 100%; padding-right: 8px; min-width: 0; gap: 6px; }
.empty-dept { padding: 12px 10px; line-height: 1.6; }
.small { font-size: 12px; }
.full { width: 100%; line-height: 1.5; margin-top: 2px; }
.danger { color: var(--yh-danger); }
.dept-info { display: flex; justify-content: space-between; align-items: center; background: var(--yh-fill); border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.leaders { flex-wrap: wrap; font-size: 13px; }
.mr4 { margin-right: 4px; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.gen { margin-top: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--yh-fill-2); padding: 6px 10px; border-radius: 6px; }
@media (max-width: 900px) {
  .org-grid { grid-template-columns: 1fr; }
  .dept-pane { max-height: 260px; }
}
</style>
