<template>
  <div class="studio-app" v-loading="loading && !app">
    <template v-if="app">
      <header class="bar">
        <el-button text @click="$router.push('/studio')"><el-icon><ArrowLeft /></el-icon></el-button>
        <AppIcon :icon="app.icon" :name="app.name" :color="app.iconColor" :size="30" />
        <div class="yh-grow" style="min-width: 0">
          <div class="bar-name yh-ellipsis">{{ app.name }} <span class="kind" :style="{ color: kindMeta.color }">{{ kindMeta.label }}</span></div>
          <div class="bar-state">
            <el-tag v-if="app.live" size="small" :type="APP_SCOPE[app.scope].type">{{ APP_SCOPE[app.scope].label }} · {{ app.live.version }}</el-tag>
            <el-tag v-else-if="app.managed" size="small" type="success">已安装</el-tag>
            <el-tag v-else size="small" type="info">未发布</el-tag>
            <el-tag v-if="app.pending" size="small" type="warning">{{ app.pending.version }} 待审核</el-tag>
            <span v-if="saveState" class="yh-muted small">{{ saveState }}</span>
          </div>
        </div>
        <el-button v-if="canOpen" @click="openApp({ ...app, url: openUrl }, $router)">打开</el-button>
        <el-button v-if="!app.readonly" type="primary" @click="openPublish">发布…</el-button>
        <el-dropdown trigger="click" @command="onMore">
          <el-button text><el-icon><MoreFilled /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="market" :disabled="!app.live && !app.managed">在市场里查看</el-dropdown-item>
              <el-dropdown-item v-if="app.kind === 'EXTERNAL' && app.live" command="secret">获取统一认证凭证</el-dropdown-item>
              <el-dropdown-item command="delete" divided><span class="danger">删除应用</span></el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <div v-if="app.readonly" class="banner info">你在查看同事发布的应用（只读）。要下架或审核，去「管理 → 审核与市场」。</div>
      <div v-if="banner" class="banner" :class="banner.type">{{ banner.text }}
        <el-button v-if="app.pending" link type="primary" @click="withdraw">撤回审核</el-button>
      </div>

      <el-tabs v-model="tab" class="tabs">
        <el-tab-pane label="内容" name="content" />
        <el-tab-pane label="上架信息" name="listing" />
        <el-tab-pane :label="`版本（${app.versions.length}）`" name="versions" />
        <el-tab-pane label="使用数据" name="usage" />
      </el-tabs>

      <div class="pane" :class="{ flush: tab === 'content' && ['AGENT', 'LITE'].includes(app.kind), readonly: app.readonly }">
        <template v-if="tab === 'content'">
          <AgentEditor v-if="app.kind === 'AGENT'" :app="app" @saving="s => saveState = s" />
          <LiteEditor v-else-if="app.kind === 'LITE'" :app="app" @saving="s => saveState = s" />
          <ExternalEditor v-else-if="app.kind === 'EXTERNAL'" :app="app" @saving="s => saveState = s" />
          <SkillEditor v-else-if="app.kind === 'SKILL'" :app="app" @saving="s => saveState = s" />
          <HostedEditor v-else :app="app" @saving="s => saveState = s" />
        </template>

        <div v-else-if="tab === 'listing'" class="form-pane">
          <el-form label-width="90px">
            <el-form-item label="名称"><el-input v-model="listing.name" maxlength="60" /></el-form-item>
            <el-form-item label="图标">
              <IconPicker v-model:icon="listing.icon" v-model:color="listing.iconColor" :name="listing.name" />
            </el-form-item>
            <el-form-item label="一句话简介"><el-input v-model="listing.description" maxlength="200" show-word-limit placeholder="市场卡片上显示，上架前必填" /></el-form-item>
            <el-form-item label="分类"><el-input v-model="listing.category" maxlength="30" placeholder="如 财务 / 行政 / 销售 / 工具" /></el-form-item>
            <el-form-item label="标签"><el-input-tag v-model="listing.tags" placeholder="回车添加，最多 8 个" :max="8" /></el-form-item>
            <el-form-item label="详细介绍">
              <el-input v-model="listing.intro" type="textarea" :autosize="{ minRows: 6, maxRows: 20 }" placeholder="支持 Markdown：能做什么、怎么用、注意事项" />
            </el-form-item>
            <el-form-item label="截图">
              <div class="shots">
                <div v-for="(s, i) in listing.screenshots" :key="i" class="shot">
                  <img :src="s" alt="" />
                  <el-button class="shot-del" circle size="small" :icon="Close" @click="listing.screenshots.splice(i, 1)" />
                </div>
                <div v-if="listing.screenshots.length < 6" class="shot add" @click="addShot"><el-icon><Plus /></el-icon></div>
              </div>
              <div class="yh-muted small">最多 6 张，每张 500KB 以内</div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingListing" @click="saveListing">保存上架信息</el-button>
              <span class="yh-muted small" style="margin-left: 10px">保存后立即生效</span>
            </el-form-item>
          </el-form>
        </div>

        <div v-else-if="tab === 'versions'" class="form-pane">
          <el-table :data="app.versions">
            <el-table-column label="版本" prop="version" width="90" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><el-tag size="small" :type="VERSION_STATUS[row.status]?.type">{{ VERSION_STATUS[row.status]?.label }}</el-tag></template>
            </el-table-column>
            <el-table-column label="范围" width="90">
              <template #default="{ row }">{{ row.status === 'DRAFT' ? '—' : APP_SCOPE[row.targetScope]?.label }}</template>
            </el-table-column>
            <el-table-column label="说明" min-width="200">
              <template #default="{ row }">
                <div>{{ row.changelog || '—' }}</div>
                <div v-if="row.reviewNote" class="small" :class="row.status === 'REJECTED' ? 'danger' : 'yh-muted'">审核意见：{{ row.reviewNote }}</div>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="150">
              <template #default="{ row }">{{ formatDateTime(row.reviewedAt || row.submittedAt || row.updatedAt) }}</template>
            </el-table-column>
            <el-table-column label="" width="100">
              <template #default="{ row }">
                <el-button v-if="row.status !== 'DRAFT'" link type="primary" @click="restore(row)">基于它修改</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-else class="form-pane"><UsagePanel :app-id="app.id" /></div>
      </div>
    </template>

    <!-- 发布 -->
    <el-dialog v-model="pub.visible" title="发布" width="560px">
      <el-form label-width="84px">
        <el-form-item label="发布给">
          <el-radio-group v-model="pub.scope" class="scopes">
            <el-radio value="PRIVATE">仅自己<span class="hint">{{ reviewHint('PRIVATE') }}</span></el-radio>
            <el-radio value="SHARED">指定同事或部门<span class="hint">{{ reviewHint('SHARED') }}</span></el-radio>
            <el-radio value="MARKET">上架到全公司市场<span class="hint">{{ reviewHint('MARKET') }}</span></el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="pub.scope !== 'PRIVATE'" :label="pub.scope === 'SHARED' ? '分享给' : '可见范围'">
          <div style="width: 100%">
            <UserSelect v-model="pub.userIds" multiple :initial="pub.userInitial" placeholder="同事" />
            <el-tree-select v-model="pub.deptIds" :data="depts" :props="{ label: 'name', children: 'children', value: 'id' }" node-key="id" multiple check-strictly filterable clearable placeholder="部门" style="width: 100%; margin-top: 8px" />
            <div v-if="pub.scope === 'MARKET'" class="yh-muted small">都不选 = 全公司都能看到</div>
          </div>
        </el-form-item>
        <el-form-item label="版本号"><el-input v-model="pub.version" maxlength="40" style="width: 160px" /></el-form-item>
        <el-form-item label="更新说明"><el-input v-model="pub.changelog" type="textarea" :rows="2" maxlength="1000" placeholder="这一版改了什么（选填）" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pub.visible = false">取消</el-button>
        <el-button type="primary" :loading="pub.saving" @click="publish">{{ needReview(pub.scope) ? '提交审核' : '发布' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="secret.visible" title="统一认证凭证" width="520px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon title="Client Secret 只显示这一次，请立即配置到你的应用服务端。之前的凭证已失效。" />
      <div class="cred">
        <div class="cred-label">Client ID</div><code>{{ secret.clientId }}</code>
        <div class="cred-label">Client Secret</div><code>{{ secret.clientSecret }}</code>
        <div class="cred-label">OIDC 发现地址（现成系统用「通用 OIDC」登录时填它）</div><code>{{ discoveryUrl }}</code>
      </div>
      <template #footer><el-button type="primary" @click="copy(secret.clientSecret)">复制 Secret</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, MoreFilled, Plus, Close } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import IconPicker from '@/components/IconPicker.vue'
import UserSelect from '@/components/UserSelect.vue'
import AgentEditor from './editors/AgentEditor.vue'
import LiteEditor from './editors/LiteEditor.vue'
import ExternalEditor from './editors/ExternalEditor.vue'
import HostedEditor from './editors/HostedEditor.vue'
import SkillEditor from './editors/SkillEditor.vue'
import UsagePanel from './UsagePanel.vue'
import { studioApi } from '@/api/market'
import { orgApi } from '@/api/org'
import { APP_KIND, APP_SCOPE, VERSION_STATUS } from '@/utils/constants'
import { openApp } from '@/utils/navigate'
import { formatDateTime, copyText } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const app = ref(null)
const loading = ref(false)
const tab = ref('content')
const saveState = ref('')
const depts = ref([])
const kindMeta = computed(() => APP_KIND[app.value?.kind] || {})

async function load() {
  loading.value = true
  try {
    app.value = await studioApi.get(route.params.id)
    fillListing()
  } finally {
    loading.value = false
  }
}
// 子编辑器保存 / 生成后需要刷新（版本列表、状态）
provide('reloadApp', load)

const openUrl = computed(() => ({ AGENT: `/assistant?app=${app.value?.id}`, LITE: `/lite/${app.value?.id}`, SKILL: `/market/${app.value?.id}` }[app.value?.kind] || app.value?.url))
const canOpen = computed(() => ['AGENT', 'LITE', 'SKILL'].includes(app.value?.kind) ? !!app.value.live : !!app.value?.url)

const banner = computed(() => {
  const a = app.value
  if (!a) return null
  if (a.adminNote) return { type: 'danger', text: a.adminNote }
  if (a.pending) return { type: 'warning', text: `${a.pending.version} 已提交审核（申请：${APP_SCOPE[a.pending.targetScope].label}）。审核通过前，用户用的仍是${a.live ? ` ${a.live.version}` : '旧版本'}；现在继续修改会存成新草稿。` }
  const rejected = a.versions.find(v => v.status === 'REJECTED' && v.id > (a.liveVersionId || 0))
  if (rejected) return { type: 'danger', text: `${rejected.version} 被打回：${rejected.reviewNote}。改好后重新发布即可。` }
  if (a.kind === 'HOSTED' && a.live && !a.managed) return { type: 'info', text: '审核已通过，正在由平台安装，稍后在「管理 → 应用」或这里看到状态。' }
  return null
})

// ---------- 发布 ----------
const pub = reactive({ visible: false, saving: false, scope: 'PRIVATE', userIds: [], deptIds: [], userInitial: [], version: '', changelog: '' })
const needReview = scope => app.value?.kind === 'HOSTED' || scope === 'MARKET' || (scope === 'SHARED' && app.value?.kind === 'EXTERNAL')
const reviewHint = scope => (needReview(scope) ? '需要管理员审核' : '马上生效')

async function openPublish() {
  const a = app.value
  const v = a.pending || a.live
  const vis = (v?.targetVisibility) || a.visibility || {}
  const draft = a.versions.find(x => x.status === 'DRAFT')
  // Skill：版本号默认用 SKILL.md 里写的 version（编辑器是异步存草稿的，取一次最新的）
  const skillVersion = a.kind === 'SKILL' ? (await studioApi.get(a.id).catch(() => null))?.working?.payload?.version : ''
  Object.assign(pub, {
    visible: true, scope: a.scope || 'PRIVATE', userIds: vis.userIds || [], deptIds: vis.deptIds || [], userInitial: [],
    version: skillVersion || draft?.version || `v${a.versions.length + 1}`, changelog: ''
  })
  if (!depts.value.length) depts.value = (await orgApi.departments().catch(() => [])) || []
  if (pub.userIds.length) {
    const r = await orgApi.users({ pageSize: 100 }).catch(() => null)
    pub.userInitial = (r?.list || []).filter(u => pub.userIds.includes(u.id))
  }
}

async function publish() {
  pub.saving = true
  try {
    const r = await studioApi.submit(app.value.id, {
      scope: pub.scope, version: pub.version, changelog: pub.changelog,
      visibility: { userIds: pub.userIds, deptIds: pub.deptIds }
    })
    pub.visible = false
    ElMessage.success(r.status === 'PENDING' ? '已提交审核，管理员审核通过后生效' : '已发布')
    load()
  } finally {
    pub.saving = false
  }
}

async function withdraw() {
  await studioApi.withdraw(app.value.id)
  ElMessage.success('已撤回，可以接着修改')
  load()
}

// ---------- 上架信息 ----------
const listing = reactive({ name: '', icon: '', iconColor: '', description: '', category: '', tags: [], intro: '', screenshots: [] })
const savingListing = ref(false)
function fillListing() {
  const a = app.value
  Object.assign(listing, {
    name: a.name, icon: a.icon || '', iconColor: a.iconColor || '', description: a.description || '', category: a.category || '',
    tags: [...(a.tags || [])], intro: a.intro || '', screenshots: [...(a.screenshots || [])]
  })
}
async function saveListing() {
  savingListing.value = true
  try {
    app.value = await studioApi.updateListing(app.value.id, { ...listing })
    fillListing()
    ElMessage.success('已保存')
  } finally {
    savingListing.value = false
  }
}
function addShot() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif'
  input.onchange = () => {
    const f = input.files?.[0]
    if (!f) return
    if (f.size > 500 * 1024) return ElMessage.warning('请压缩到 500KB 以内')
    const r = new FileReader()
    r.onload = () => listing.screenshots.push(r.result)
    r.readAsDataURL(f)
  }
  input.click()
}

// ---------- 版本 ----------
async function restore(v) {
  try {
    await ElMessageBox.confirm(`把 ${v.version} 的内容复制成新草稿？当前草稿里没发布的修改会被覆盖。`, '基于历史版本修改', { type: 'warning', confirmButtonText: '复制', cancelButtonText: '取消' })
  } catch {
    return
  }
  app.value = await studioApi.restore(app.value.id, v.id)
  tab.value = 'content'
  ElMessage.success('已复制成草稿')
}

// ---------- 更多 ----------
const secret = reactive({ visible: false, clientId: '', clientSecret: '' })
const discoveryUrl = `${window.location.origin}/.well-known/openid-configuration`
async function onMore(cmd) {
  if (cmd === 'market') return router.push(`/market/${app.value.id}`)
  if (cmd === 'secret') {
    try {
      await ElMessageBox.confirm('生成新的 Client Secret？旧的立即失效。', '获取凭证', { type: 'warning', confirmButtonText: '生成', cancelButtonText: '取消' })
    } catch {
      return
    }
    Object.assign(secret, { visible: true, ...(await studioApi.secret(app.value.id)) })
  }
  if (cmd === 'delete') {
    try {
      await ElMessageBox.confirm(`删除「${app.value.name}」？所有版本一起删除，已经装了它的同事也用不了了。`, '删除应用', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' })
    } catch {
      return
    }
    await studioApi.remove(app.value.id)
    ElMessage.success('已删除')
    router.replace('/studio')
  }
}
async function copy(t) {
  if (await copyText(t)) ElMessage.success('已复制')
}

onMounted(load)
</script>

<style scoped>
.studio-app { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--yh-card); border-bottom: 1px solid var(--yh-border-soft); }
.bar-name { font-weight: 600; font-size: 15px; }
.kind { font-size: 12px; font-weight: 500; margin-left: 4px; }
.bar-state { display: flex; gap: 6px; align-items: center; margin-top: 2px; }
.banner { padding: 8px 16px; font-size: 13px; }
.banner.warning { background: #fffbeb; color: #92400e; }
.banner.danger { background: #fef2f2; color: #991b1b; }
.banner.info { background: var(--yh-primary-soft); color: var(--yh-primary-dark); }
.tabs { padding: 0 16px; background: var(--yh-card); }
.tabs :deep(.el-tabs__header) { margin: 0; }
.pane { flex: 1; min-height: 0; overflow: auto; }
.pane.flush { overflow: hidden; }
.pane.readonly :deep(textarea), .pane.readonly :deep(input) { pointer-events: none; }
.form-pane { max-width: 860px; padding: 20px 24px 40px; }
.shots { display: flex; gap: 10px; flex-wrap: wrap; }
.shot { width: 150px; height: 96px; border-radius: 8px; border: 1px solid var(--yh-border); overflow: hidden; position: relative; }
.shot img { width: 100%; height: 100%; object-fit: cover; }
.shot-del { position: absolute; top: 4px; right: 4px; }
.shot.add { border-style: dashed; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--yh-text-3); font-size: 20px; }
.scopes { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.hint { font-size: 12px; color: var(--yh-text-3); margin-left: 8px; }
.cred { margin-top: 14px; }
.cred-label { font-size: 12px; color: var(--yh-text-3); margin: 10px 0 4px; }
.cred code { display: block; background: var(--yh-fill-2); padding: 8px 10px; border-radius: 6px; word-break: break-all; user-select: all; }
.small { font-size: 12px; }
.danger { color: var(--yh-danger); }
</style>
