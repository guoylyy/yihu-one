<template>
  <div>
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 14px">
      <template #title>
        一套平台里可以开多个<b>空间</b>：自己公司、兄弟公司、客户各一个。不同空间的人互相看不到——同事、部门、应用、Skill、知识库都按空间分开；
        管理员能跨空间管理。应用默认只在它所属的空间里，可以在「应用」里分享给别的空间。只有一个空间时，其他页面上不会出现「空间」。
      </template>
    </el-alert>
    <div class="bar">
      <el-button type="primary" :icon="Plus" @click="openEdit()">新建空间</el-button>
    </div>
    <el-table v-loading="loading" :data="list">
      <el-table-column label="空间" min-width="180">
        <template #default="{ row }"><b>{{ row.name }}</b> <code class="code">{{ row.code }}</code> <el-tag v-if="row.isDefault" size="small" effect="plain">默认</el-tag></template>
      </el-table-column>
      <el-table-column label="类型" width="110"><template #default="{ row }">{{ row.kind === 'CUSTOMER' ? '客户' : '自己公司' }}</template></el-table-column>
      <el-table-column label="人" prop="users" width="80" />
      <el-table-column label="部门" prop="departments" width="80" />
      <el-table-column label="应用" prop="apps" width="80" />
      <el-table-column label="知识库" prop="knowledgeBases" width="90" />
      <el-table-column label="VI" width="130">
        <template #default="{ row }">
          <span v-if="row.brand" class="vi-on">自己的 VI</span>
          <span v-else class="yh-muted">跟随平台</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="190" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="openBrand(row)">VI</el-button>
          <el-button v-if="!row.isDefault" link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="yh-muted small tip">新空间建好后：在「用户与部门」里把人加到这个空间（或同步通讯录时选这个空间），在「应用」里决定哪些应用给它用。</div>

    <!-- 空间自己的 VI：这个空间的人登录后看到的平台名称、LOGO、配色。关掉 = 跟随平台（系统设置 → 外观与主题） -->
    <el-dialog v-model="bd.visible" :title="`「${bd.spaceName}」的 VI`" width="min(1080px, 96vw)" top="5vh">
      <div class="bd-switch">
        <el-switch v-model="bd.own" active-text="这个空间用自己的 VI" inactive-text="跟随平台" />
      </div>
      <template v-if="bd.own">
        <el-form label-width="96px" class="bd-form">
          <el-form-item label="平台名称"><el-input v-model="bd.name" maxlength="60" placeholder="留空用平台名称，如：示例工作台" style="max-width: 320px" /></el-form-item>
          <el-form-item label="LOGO">
            <div class="bd-logo">
              <div class="bd-logo-box" :class="{ empty: !bd.logo }"><img v-if="bd.logo" :src="bd.logo" alt="" /><span v-else>未设置</span></div>
              <el-button size="small" @click="pickLogo">{{ bd.logo ? '更换' : '上传' }}</el-button>
              <el-button v-if="bd.logo" size="small" link type="danger" @click="bd.logo = ''">移除</el-button>
              <span class="yh-muted small">不设置用平台 LOGO / 预设 LOGO；PNG / SVG，不超过 200KB</span>
            </div>
          </el-form-item>
        </el-form>
        <ThemeEditor v-if="bd.catalog" v-model="bd.theme" :catalog="bd.catalog" :name="bd.name || app.workspaceName" :logo="bd.logo" />
      </template>
      <template #footer>
        <el-button @click="bd.visible = false">取消</el-button>
        <el-button type="primary" :loading="bd.saving" @click="saveBrand">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dlg.visible" :title="dlg.id ? '编辑空间' : '新建空间'" width="460px">
      <el-form label-width="80px">
        <el-form-item label="名称"><el-input v-model="dlg.name" maxlength="100" placeholder="如：示例科技" /></el-form-item>
        <el-form-item label="code"><el-input v-model="dlg.code" :disabled="dlg.isDefault" placeholder="小写英文，如 acme" /></el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="dlg.kind">
            <el-radio value="INTERNAL">自己公司</el-radio>
            <el-radio value="CUSTOMER">客户</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { adminApi } from '@/api/admin'
import { useUserStore } from '@/stores/user'
import { useAppStore } from '@/stores/app'
import ThemeEditor from '@/components/ThemeEditor.vue'

const user = useUserStore()
const app = useAppStore()
const list = ref([])
const loading = ref(false)
const dlg = reactive({ visible: false, saving: false, id: null, name: '', code: '', kind: 'INTERNAL', isDefault: false })

async function load() {
  loading.value = true
  try { list.value = await adminApi.spaces() } finally { loading.value = false }
}
function openEdit(row) {
  Object.assign(dlg, row ? { id: row.id, name: row.name, code: row.code, kind: row.kind, isDefault: row.isDefault } : { id: null, name: '', code: '', kind: 'INTERNAL', isDefault: false })
  dlg.visible = true
}
async function save() {
  dlg.saving = true
  try {
    const body = { name: dlg.name, code: dlg.code, kind: dlg.kind }
    if (dlg.id) await adminApi.updateSpace(dlg.id, body)
    else await adminApi.createSpace(body)
    dlg.visible = false
    ElMessage.success('已保存')
    await load()
    user.fetchMe?.() // 多了一个空间后，其他页面要显示「空间」
  } finally {
    dlg.saving = false
  }
}
const bd = reactive({ visible: false, saving: false, id: null, spaceName: '', own: false, name: '', logo: '', theme: null, catalog: null })
async function openBrand(row) {
  if (!bd.catalog) bd.catalog = await adminApi.themeCatalog()
  const b = row.brand || {}
  // 没设置过：从平台当前的 VI 开始改
  const base = app.config?.theme
  Object.assign(bd, {
    id: row.id, spaceName: row.name, own: !!row.brand, name: b.name || '', logo: b.logo || '',
    theme: b.theme || (base ? { preset: base.preset, tokens: Object.fromEntries((base.custom || []).map(k => [k, base.tokens[k]])) } : null)
  })
  bd.visible = true
}
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
function pickLogo() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = IMAGE_TYPES.join(',')
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return ElMessage.warning('只支持 PNG / JPG / GIF / WebP / SVG 图片')
    if (file.size > 200 * 1024) return ElMessage.warning('图片请压缩到 200KB 以内')
    const reader = new FileReader()
    reader.onload = () => { bd.logo = reader.result }
    reader.readAsDataURL(file)
  }
  input.click()
}
async function saveBrand() {
  bd.saving = true
  try {
    await adminApi.updateSpace(bd.id, { brand: bd.own ? { name: bd.name, logo: bd.logo, theme: bd.theme } : null })
    bd.visible = false
    ElMessage.success('已保存，这个空间的人刷新页面后生效')
    await load()
    user.fetchMe?.() // 自己就在这个空间里时立即换上
  } finally {
    bd.saving = false
  }
}
async function remove(row) {
  await ElMessageBox.confirm(`删除空间「${row.name}」？只有空的空间能删。`, '删除', { type: 'warning' })
  await adminApi.removeSpace(row.id)
  ElMessage.success('已删除')
  load()
}
onMounted(load)
</script>

<style scoped>
.bar { margin-bottom: 12px; }
.code { font-size: 12px; color: var(--yh-text-3); }
.small { font-size: 12px; }
.tip { margin-top: 12px; }
.vi-on { color: var(--yh-highlight); font-weight: 500; }
.bd-switch { margin-bottom: 16px; }
.bd-form { margin-bottom: 8px; }
.bd-logo { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bd-logo-box { width: 48px; height: 48px; border: 1px solid var(--yh-border); border-radius: var(--yh-radius-sm); display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--yh-fill); }
.bd-logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
.bd-logo-box.empty { border-style: dashed; color: var(--yh-text-3); font-size: 11px; }
</style>
