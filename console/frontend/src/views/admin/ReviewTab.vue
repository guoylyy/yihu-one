<template>
  <div>
    <el-radio-group v-model="sub" class="subs" @change="load">
      <el-radio-button value="pending">待审核<span v-if="counts.pending" class="badge">{{ counts.pending }}</span></el-radio-button>
      <el-radio-button value="done">已处理</el-radio-button>
      <el-radio-button value="reports">举报<span v-if="counts.reports" class="badge">{{ counts.reports }}</span></el-radio-button>
      <el-radio-button value="apps">员工发布的应用</el-radio-button>
      <el-radio-button value="settings">市场设置</el-radio-button>
    </el-radio-group>

    <!-- 审核 -->
    <template v-if="sub === 'pending' || sub === 'done'">
      <el-table v-loading="loading" :data="versions" empty-text="没有待审核的版本">
        <el-table-column label="应用" min-width="220">
          <template #default="{ row }">
            <div class="yh-flex">
              <AppIcon :icon="row.app.icon" :name="row.app.name" :color="row.app.iconColor" :size="30" />
              <div style="min-width: 0">
                <div class="yh-flex">{{ row.app.name }} <span class="kind" :style="{ color: APP_KIND[row.app.kind].color }">{{ APP_KIND[row.app.kind].label }}</span></div>
                <div class="yh-muted small">{{ row.version }} · 申请{{ APP_SCOPE[row.targetScope].label }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="发布者" width="120"><template #default="{ row }">{{ row.publisher?.name || '—' }}</template></el-table-column>
        <el-table-column label="更新说明" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ row.changelog || '—' }}</template></el-table-column>
        <el-table-column v-if="sub === 'done'" label="结果" width="200">
          <template #default="{ row }">
            <el-tag size="small" :type="VERSION_STATUS[row.status].type">{{ row.status === 'REJECTED' ? '已打回' : '已通过' }}</el-tag>
            <span class="yh-muted small"> {{ row.reviewer?.name }}</span>
            <div v-if="row.reviewNote" class="yh-muted small yh-ellipsis" :title="row.reviewNote">{{ row.reviewNote }}</div>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="140"><template #default="{ row }">{{ fromNow(row.submittedAt) }}</template></el-table-column>
        <el-table-column label="" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="openReview(row)">{{ sub === 'pending' ? '审核' : '查看' }}</el-button></template>
        </el-table-column>
      </el-table>
    </template>

    <!-- 举报 -->
    <el-table v-else-if="sub === 'reports'" v-loading="loading" :data="reports" empty-text="没有待处理的举报">
      <el-table-column label="应用" min-width="180">
        <template #default="{ row }">
          <div class="yh-flex"><AppIcon :icon="row.app?.icon" :name="row.app?.name" :color="row.app?.iconColor" :size="26" /><a class="yh-link" @click="$router.push(`/market/${row.app?.id}`)">{{ row.app?.name }}</a></div>
          <div class="yh-muted small">发布者 {{ row.app?.publisher?.name || '—' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="举报内容" min-width="240"><template #default="{ row }"><div class="reason">{{ row.reason }}</div></template></el-table-column>
      <el-table-column label="举报人" width="110"><template #default="{ row }">{{ row.reporter?.name }}</template></el-table-column>
      <el-table-column label="时间" width="110"><template #default="{ row }">{{ fromNow(row.createdAt) }}</template></el-table-column>
      <el-table-column label="" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" @click="resolve(row, 'delist')">下架</el-button>
          <el-button link @click="resolve(row, 'dismiss')">忽略</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 员工发布的应用 -->
    <template v-else-if="sub === 'apps'">
      <div class="toolbar">
        <el-input v-model="q" placeholder="搜索" clearable style="width: 200px" @change="load" @clear="load" />
        <el-select v-model="fkind" placeholder="全部类型" clearable style="width: 130px" @change="load">
          <el-option v-for="(v, k) in APP_KIND" :key="k" :label="v.label" :value="k" />
        </el-select>
        <el-select v-model="fscope" placeholder="全部范围" clearable style="width: 130px" @change="load">
          <el-option v-for="(v, k) in APP_SCOPE" :key="k" :label="v.label" :value="k" />
        </el-select>
      </div>
      <el-table v-loading="loading" :data="apps" empty-text="还没有员工发布的应用">
        <el-table-column label="应用" min-width="200">
          <template #default="{ row }">
            <div class="yh-flex"><AppIcon :icon="row.icon" :name="row.name" :color="row.iconColor" :size="28" />
              <div><div>{{ row.name }} <span class="kind" :style="{ color: APP_KIND[row.kind].color }">{{ APP_KIND[row.kind].label }}</span></div><div class="yh-muted small">{{ row.code }}</div></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="发布者" width="110"><template #default="{ row }">{{ row.publisher?.name }}</template></el-table-column>
        <el-table-column label="范围" width="90"><template #default="{ row }"><el-tag size="small" :type="APP_SCOPE[row.scope].type">{{ APP_SCOPE[row.scope].label }}</el-tag></template></el-table-column>
        <el-table-column label="在用" width="70" prop="installs" />
        <el-table-column label="更新" width="110"><template #default="{ row }">{{ fromNow(row.updatedAt) }}</template></el-table-column>
        <el-table-column label="" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/market/${row.id}`)">查看</el-button>
            <el-button v-if="row.scope !== 'PRIVATE'" link type="danger" @click="delist(row)">下架</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <SettingsTab v-else page="market" intro="员工发布应用的开关和额度。AI 助手和轻应用仅自己用、分享给同事时马上生效；上架到全公司市场、外部应用分享、代码应用都要在这里审核。" />

    <!-- 审核详情 -->
    <el-drawer v-model="rv.visible" size="820px" :title="rv.data ? `${rv.data.app.name} · ${rv.data.version}` : '审核'" destroy-on-close>
      <div v-if="rv.data" class="rv">
        <div class="rv-head">
          <AppIcon :icon="rv.data.app.icon" :name="rv.data.app.name" :color="rv.data.app.iconColor" :size="44" />
          <div class="yh-grow">
            <div><b>{{ rv.data.app.name }}</b> <span class="kind" :style="{ color: APP_KIND[rv.data.app.kind].color }">{{ APP_KIND[rv.data.app.kind].label }}</span></div>
            <div class="yh-muted small">{{ rv.data.app.description || '没有简介' }}</div>
            <div class="small">发布者 {{ rv.data.publisher?.name }} · 申请<b>{{ APP_SCOPE[rv.data.targetScope].label }}</b>{{ visText(rv.data.targetVisibility) }}</div>
          </div>
        </div>
        <div v-if="rv.data.changelog" class="rv-sec"><div class="rv-title">更新说明</div>{{ rv.data.changelog }}</div>
        <div class="rv-sec">
          <div class="rv-title">这个版本的内容 <span v-if="rv.data.live" class="yh-muted small">（右边是当前生效的 {{ rv.data.live.version }}）</span></div>
          <div class="cmp" :class="{ two: rv.data.live }">
            <PayloadView :kind="rv.data.app.kind" :payload="rv.data.payload" :permissions="rv.data.permissions" :app-id="rv.data.app.id" :version-id="rv.data.id" />
            <PayloadView v-if="rv.data.live" :kind="rv.data.app.kind" :payload="rv.data.live.payload" :permissions="rv.data.live.permissions" class="old" />
          </div>
        </div>
        <div v-if="rv.data.status === 'PENDING'" class="rv-sec">
          <div class="rv-title">审核意见</div>
          <el-input v-model="rv.note" type="textarea" :rows="3" placeholder="通过时选填；打回时必填，发布者据此修改" />
          <div class="rv-actions">
            <el-button type="danger" plain :loading="rv.saving === 'reject'" @click="decide('reject')">打回</el-button>
            <el-button type="primary" :loading="rv.saving === 'approve'" @click="decide('approve')">通过{{ rv.data.app.kind === 'HOSTED' ? '并安装' : '' }}</el-button>
          </div>
        </div>
        <div v-else class="rv-sec yh-muted">已{{ rv.data.status === 'REJECTED' ? '打回' : '通过' }}{{ rv.data.reviewNote ? `：${rv.data.reviewNote}` : '' }}</div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import SettingsTab from './SettingsTab.vue'
import PayloadView from './PayloadView.vue'
import { reviewApi } from '@/api/market'
import { APP_KIND, APP_SCOPE, VERSION_STATUS } from '@/utils/constants'
import { fromNow } from '@/utils/format'

const sub = ref('pending')
const loading = ref(false)
const versions = ref([])
const reports = ref([])
const apps = ref([])
const counts = reactive({ pending: 0, reports: 0 })
const q = ref('')
const fkind = ref('')
const fscope = ref('')

async function refreshCounts() {
  const [p, r] = await Promise.all([reviewApi.list('PENDING').catch(() => []), reviewApi.reports('OPEN').catch(() => [])])
  counts.pending = p.length
  counts.reports = r.length
  return { p, r }
}

async function load() {
  if (sub.value === 'settings') return
  loading.value = true
  try {
    if (sub.value === 'pending') versions.value = (await refreshCounts()).p
    else if (sub.value === 'done') versions.value = ((await reviewApi.list('ALL')) || []).filter(v => v.status !== 'PENDING')
    else if (sub.value === 'reports') reports.value = (await refreshCounts()).r
    else apps.value = (await reviewApi.apps({ q: q.value, kind: fkind.value, scope: fscope.value })) || []
  } finally {
    loading.value = false
  }
}

const rv = reactive({ visible: false, data: null, note: '', saving: '' })
async function openReview(row) {
  Object.assign(rv, { visible: true, data: null, note: '', saving: '' })
  rv.data = await reviewApi.detail(row.id)
}
async function decide(action) {
  if (action === 'reject' && !rv.note.trim()) return ElMessage.warning('打回要写原因')
  rv.saving = action
  try {
    await reviewApi[action](rv.data.id, rv.note)
    ElMessage.success(action === 'approve' ? (rv.data.app.kind === 'HOSTED' ? '已通过，平台开始安装' : '已通过，已生效') : '已打回')
    rv.visible = false
    load()
  } finally {
    rv.saving = ''
  }
}

function visText(v) {
  if (!v) return ''
  const parts = []
  if (v.userIds?.length) parts.push(`${v.userIds.length} 位同事`)
  if (v.deptIds?.length) parts.push(`${v.deptIds.length} 个部门`)
  return parts.length ? `（${parts.join('、')}）` : ''
}

async function askReason(title) {
  const { value } = await ElMessageBox.prompt('写上原因，发布者会看到', title, {
    confirmButtonText: '确定', cancelButtonText: '取消', inputType: 'textarea', inputValidator: v => !!v?.trim() || '请填写原因'
  })
  return value
}
async function delist(row) {
  let reason
  try { reason = await askReason(`下架「${row.name}」`) } catch { return }
  await reviewApi.delist(row.id, reason)
  ElMessage.success('已下架')
  load()
}
async function resolve(row, action) {
  let note = ''
  if (action === 'delist') {
    try { note = await askReason(`下架「${row.app?.name}」`) } catch { return }
  }
  await reviewApi.resolveReport(row.id, action, note)
  ElMessage.success(action === 'delist' ? '已下架' : '已忽略')
  load()
}

onMounted(load)
</script>

<style scoped>
.subs { margin-bottom: 16px; }
.badge { display: inline-block; min-width: 16px; height: 16px; line-height: 16px; border-radius: 8px; background: var(--yh-danger); color: #fff; font-size: 11px; margin-left: 5px; padding: 0 4px; }
.toolbar { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.kind { font-size: 12px; font-weight: 500; }
.small { font-size: 12px; }
.reason { white-space: pre-wrap; font-size: 13px; }
.rv-head { display: flex; gap: 12px; align-items: flex-start; }
.rv-sec { margin-top: 18px; font-size: 13px; }
.rv-title { font-weight: 600; margin-bottom: 8px; }
.cmp.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.old { opacity: .75; }
.rv-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
</style>
