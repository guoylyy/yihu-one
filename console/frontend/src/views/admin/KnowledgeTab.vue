<template>
  <div class="kb">
    <el-alert type="info" :closable="false" show-icon class="mb">
      <template #title>把企业制度、财务、考勤、业务知识文档传到这里，员工在 AI 助手里提问时会基于这些内容回答并注明来源。先在「模型与 AI」配一个向量（embedding）模型，再上传文档。</template>
    </el-alert>

    <div class="toolbar">
      <span class="yh-muted small">{{ kbs.length }} 个知识库</span>
      <div class="yh-grow"></div>
      <el-button type="primary" :icon="Plus" @click="openKb(null)">新建知识库</el-button>
    </div>

    <div class="kb-grid">
      <!-- 知识库列表 -->
      <div class="kb-list">
        <div
          v-for="kb in kbs"
          :key="kb.id"
          class="kb-item"
          :class="{ active: currentId === kb.id }"
          @click="select(kb.id)"
        >
          <div class="kb-item-name yh-ellipsis">{{ kb.name }}</div>
          <div class="kb-item-meta yh-muted small">
            <el-icon v-if="!kb.enabled"><WarningFilled /></el-icon>
            {{ SCOPE_LABEL[kb.scope] }} · {{ kb.docCount }} 文档
          </div>
        </div>
        <div v-if="!kbs.length" class="yh-muted small empty">还没有知识库，点右上角新建</div>
      </div>

      <!-- 文档 -->
      <div class="kb-docs">
        <template v-if="current">
          <div class="doc-head">
            <div>
              <b>{{ current.name }}</b>
              <el-tag size="small" effect="plain" class="ml8">{{ SCOPE_LABEL[current.scope] }}</el-tag>
              <el-tag v-if="!current.enabled" size="small" type="warning" class="ml8">已停用</el-tag>
            </div>
            <div class="yh-flex">
              <el-button link type="primary" @click="openKb(current)">编辑</el-button>
              <el-button link type="danger" @click="removeKb(current)">删除</el-button>
            </div>
          </div>
          <div v-if="current.description" class="yh-muted small desc">{{ current.description }}</div>

          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :show-file-list="false"
            multiple
            accept=".pdf,.docx,.txt,.md,.markdown"
            :on-change="onPick"
          >
            <el-button :icon="Upload" :loading="uploading">上传文档（PDF / Word / TXT / Markdown）</el-button>
          </el-upload>

          <el-table :data="docs" size="default" class="doc-table">
            <el-table-column label="文档" min-width="220">
              <template #default="{ row }">
                <div>{{ row.name }}</div>
                <div class="yh-muted small">{{ row.fileType }} · {{ kbSize(row.size) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="170">
              <template #default="{ row }">
                <el-tag v-if="row.status === 'READY'" size="small" type="success">已就绪 · {{ row.chunkCount }} 片段</el-tag>
                <el-tag v-else-if="row.status === 'PROCESSING'" size="small" type="warning">处理中…</el-tag>
                <el-tag v-else-if="row.status === 'PENDING'" size="small" type="info">排队中…</el-tag>
                <el-tag v-else size="small" type="danger">失败</el-tag>
                <div v-if="row.status === 'FAILED' && row.error" class="err yh-muted small">{{ row.error }}</div>
              </template>
            </el-table-column>
            <el-table-column label="更新时间" width="150">
              <template #default="{ row }"><span class="small yh-muted">{{ formatDateTime(row.updatedAt) }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button v-if="row.status === 'FAILED'" link type="primary" @click="reprocess(row)">重处理</el-button>
                <el-button link type="danger" @click="removeDoc(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
        <el-empty v-else description="选择或新建一个知识库" />
      </div>
    </div>

    <!-- 知识库编辑 -->
    <el-dialog v-model="kbDlg.visible" :title="kbDlg.id ? '编辑知识库' : '新建知识库'" width="520px">
      <el-form label-width="96px">
        <el-form-item label="名称" required>
          <el-input v-model="kbDlg.form.name" placeholder="如 财务制度、考勤规范" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="kbDlg.form.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="这个知识库存什么（选填）" />
        </el-form-item>
        <el-form-item v-if="multiSpace" label="所属空间">
          <el-select v-model="kbDlg.form.spaceId" style="width: 100%">
            <el-option v-for="sp in spaces" :key="sp.id" :label="sp.name" :value="sp.id" />
          </el-select>
          <div class="yh-muted small">只有这个空间的人能检索到（管理员都能看到）</div>
        </el-form-item>
        <el-form-item label="可见范围">
          <el-radio-group v-model="kbDlg.form.scope">
            <el-radio value="ALL">全员</el-radio>
            <el-radio value="DEPT">指定部门</el-radio>
            <el-radio value="ADMIN">仅管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="kbDlg.form.scope === 'DEPT'" label="选择部门">
          <el-tree
            :data="deptTreeData"
            node-key="id"
            show-checkbox
            :props="{ label: 'name', children: 'children' }"
            default-expand-all
            ref="deptTreeRef"
          />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="kbDlg.form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="kbDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="saveKb">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, WarningFilled } from '@element-plus/icons-vue'
import { kbApi } from '@/api/kb'
import { orgApi } from '@/api/org'
import { adminApi } from '@/api/admin'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/format'

const SCOPE_LABEL = { ALL: '全员可见', DEPT: '按部门', ADMIN: '仅管理员' }

const kbs = ref([])
const currentId = ref(null)
const docs = ref([])
const uploading = ref(false)
const current = computed(() => kbs.value.find(k => k.id === currentId.value) || null)

const user = useUserStore()
const multiSpace = computed(() => !!user.me?.multiSpace)
const spaces = ref([])
const kbDlg = reactive({ visible: false, id: null, form: { name: '', description: '', scope: 'ALL', enabled: true } })
const deptTreeData = ref([])
const deptTreeRef = ref(null)
const uploadRef = ref(null)

function kbSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

async function loadKbs() {
  kbs.value = (await kbApi.list()) || []
  if (currentId.value && !kbs.value.find(k => k.id === currentId.value)) currentId.value = null
  if (!currentId.value && kbs.value[0]) await select(kbs.value[0].id)
}

async function select(id) {
  currentId.value = id
  await loadDocs()
}

async function loadDocs() {
  if (!currentId.value) { docs.value = []; return }
  docs.value = (await kbApi.documents(currentId.value)) || []
}

// ---------- 上传 ----------

async function onPick(file) {
  if (!file?.raw) return
  if (!currentId.value) return ElMessage.warning('先选择一个知识库')
  uploading.value = true
  try {
    await kbApi.upload(currentId.value, file.raw)
    ElMessage.success(`已上传 ${file.name}，正在后台处理`)
    await loadDocs()
    // 处理是异步的, 稍后刷新状态
    setTimeout(loadDocs, 8_000)
  } finally {
    uploading.value = false
  }
}

async function reprocess(row) {
  await kbApi.reprocess(row.id)
  ElMessage.success('已重新排队处理')
  setTimeout(loadDocs, 8_000)
}

async function removeDoc(row) {
  try {
    await ElMessageBox.confirm(`删除文档「${row.name}」？它的全部片段会一起删掉`, '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  await kbApi.removeDocument(row.id)
  ElMessage.success('已删除')
  loadDocs()
  loadKbs()
}

// ---------- 知识库编辑 ----------

async function openKb(kb) {
  await loadDeptTree()
  kbDlg.id = kb?.id || null
  kbDlg.form = {
    name: kb?.name || '', description: kb?.description || '',
    scope: kb?.scope || 'ALL', enabled: kb ? kb.enabled : true,
    spaceId: kb?.spaceId || user.me?.space?.id || 1
  }
  if (multiSpace.value && !spaces.value.length) spaces.value = (await adminApi.spaces().catch(() => [])) || []
  kbDlg.visible = true
  if (kb && kb.scope === 'DEPT') {
    await nextTickSafe()
    deptTreeRef.value?.setCheckedKeys(kb.deptIds || [])
  }
}

async function loadDeptTree() {
  if (deptTreeData.value.length) return
  deptTreeData.value = (await orgApi.departments()) || []
}

const nextTickSafe = () => new Promise(r => setTimeout(r, 50))

async function saveKb() {
  const f = kbDlg.form
  if (!f.name.trim()) return ElMessage.warning('请填写名称')
  let deptIds = []
  if (f.scope === 'DEPT') {
    deptIds = deptTreeRef.value?.getCheckedKeys().filter(id => typeof id === 'number') || []
    if (!deptIds.length) return ElMessage.warning('按部门可见时至少选一个部门')
  }
  const payload = { name: f.name.trim(), description: f.description, scope: f.scope, enabled: f.enabled, deptIds, ...(multiSpace.value ? { spaceId: f.spaceId } : {}) }
  if (kbDlg.id) await kbApi.update(kbDlg.id, payload)
  else await kbApi.create(payload)
  ElMessage.success('已保存')
  kbDlg.visible = false
  await loadKbs()
}

async function removeKb(kb) {
  try {
    await ElMessageBox.confirm(`删除知识库「${kb.name}」？其中的 ${kb.docCount} 个文档和全部片段都会删除`, '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  await kbApi.remove(kb.id)
  ElMessage.success('已删除')
  currentId.value = null
  loadKbs()
}

onMounted(loadKbs)
</script>

<style scoped>
.mb { margin-bottom: 14px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.ml8 { margin-left: 8px; }
.kb-grid { display: grid; grid-template-columns: 240px 1fr; gap: 16px; min-height: 360px; }
.kb-list { border: 1px solid var(--yh-border); border-radius: 8px; padding: 6px; }
.kb-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.kb-item:hover { background: var(--yh-fill-1); }
.kb-item.active { background: var(--yh-primary-soft); }
.kb-item-name { font-weight: 500; }
.kb-item-meta { margin-top: 2px; display: flex; align-items: center; gap: 4px; }
.empty { padding: 20px; text-align: center; }
.doc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.desc { margin-bottom: 12px; }
.doc-table { margin-top: 12px; }
.err { margin-top: 4px; line-height: 1.5; }
</style>
