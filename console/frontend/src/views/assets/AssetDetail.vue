<template>
  <div class="yh-page asset" v-loading="loading">
    <div class="back"><a class="yh-link" @click="$router.push('/assets')">‹ 资料</a></div>
    <template v-if="a">
      <div class="yh-card head">
        <div class="yh-grow">
          <div class="title">{{ a.name }} <el-tag size="small" effect="plain">{{ a.categoryLabel }}</el-tag> <span class="yh-muted ver">{{ a.version ? 'v' + a.version : '还没有文件' }}</span></div>
          <div class="yh-muted desc">{{ a.description || '暂无简介' }}</div>
          <div class="yh-muted small">责任人：{{ a.owner?.name || '—' }} · 更新于 {{ formatDateTime(a.updatedAt) }}</div>
        </div>
        <div v-if="a.canEdit" class="actions">
          <el-button type="primary" @click="openVersion">上传新版本</el-button>
          <el-button @click="openEdit">编辑信息</el-button>
          <el-button v-if="user.permissions.admin" text type="danger" @click="remove">删除</el-button>
        </div>
      </div>
      <el-alert v-if="a.updateAvailable" type="warning" :closable="false" show-icon style="margin-bottom: 16px"
        :title="`你上次用的是 v${a.myVersion}，现在是 v${a.version}：重新下载，或让 Agent 用 check_asset_updates / get_asset 换成新的`" />

      <!-- 品牌规范（结构化，Agent 照这个做） -->
      <section v-if="a.spec" class="yh-card">
        <div class="yh-card-title">规范</div>
        <div v-if="a.spec.colors?.length" class="swatches">
          <div v-for="c in a.spec.colors" :key="c.hex + c.name" class="swatch" @click="copyText(c.hex)">
            <span class="chip" :style="{ background: c.hex }"></span>
            <div><b>{{ c.name }}</b> <code>{{ c.hex }}</code><div class="yh-muted small">{{ c.usage }}</div></div>
          </div>
        </div>
        <div v-if="a.spec.fonts?.length" class="sub">
          <div class="sub-title">字体</div>
          <div v-for="f in a.spec.fonts" :key="f.name" class="font"><b>{{ f.name }}</b> <span class="yh-muted">{{ f.usage }}</span><span v-if="f.fallback" class="yh-muted small">（没有时用 {{ f.fallback }}）</span></div>
        </div>
        <div v-if="a.spec.rules?.length" class="sub">
          <div class="sub-title">使用规则</div>
          <ul class="rules"><li v-for="(r, i) in a.spec.rules" :key="i">{{ r }}</li></ul>
        </div>
        <div v-if="a.spec.voice" class="sub"><div class="sub-title">文案口吻</div><div class="plain">{{ a.spec.voice }}</div></div>
      </section>

      <section class="yh-card">
        <div class="yh-card-title">文件 <span class="yh-muted small">{{ a.files.length }}</span></div>
        <div v-if="!a.files.length" class="yh-muted small">还没有文件{{ a.canEdit ? '，点「上传新版本」' : '' }}</div>
        <div class="files">
          <div v-for="f in a.files" :key="f.id" class="file">
            <div class="thumb">
              <img v-if="f.mime.startsWith('image/')" :src="f.url" alt="" />
              <span v-else class="ext">{{ ext(f.name) }}</span>
            </div>
            <div class="yh-grow" style="min-width: 0">
              <div class="fname">{{ f.name }}</div>
              <div class="yh-muted small">{{ formatSize(f.size) }}</div>
            </div>
            <a class="yh-link" :href="f.url + '&dl=1'" @click="downloaded">下载</a>
          </div>
        </div>
      </section>

      <div class="cols">
        <section class="yh-card">
          <div class="yh-card-title">版本记录</div>
          <div v-if="!a.versions.length" class="yh-muted small">暂无</div>
          <div v-for="v in a.versions" :key="v.version" class="ver-row">
            <b>v{{ v.version }}</b> <span class="yh-muted small">{{ formatDateTime(v.at) }} · {{ v.by?.name }}</span>
            <div v-if="v.changelog" class="yh-muted small">{{ v.changelog }}</div>
          </div>
        </section>
        <section class="yh-card">
          <div class="yh-card-title">配套的 Skill</div>
          <div class="yh-muted small">资料是素材，Skill 是做法：装上这些 Skill，Agent 就知道怎么用这份资料</div>
          <div v-if="!a.relatedSkills.length" class="yh-muted small" style="margin-top: 8px">还没有</div>
          <div v-for="s in a.relatedSkills" :key="s.id" class="skill"><a class="yh-link" @click="$router.push(`/market/${s.id}`)">📘 {{ s.name }}</a></div>
        </section>
      </div>
    </template>

    <!-- 编辑信息、规范、责任人 -->
    <el-dialog v-model="edit.visible" title="编辑资料" width="640px">
      <el-form label-width="84px">
        <el-form-item label="名称"><el-input v-model="edit.name" maxlength="100" /></el-form-item>
        <el-form-item label="简介"><el-input v-model="edit.description" type="textarea" :rows="2" maxlength="1000" /></el-form-item>
        <el-form-item v-if="user.permissions.admin" label="责任人">
          <UserSelect v-model="edit.ownerId" :initial="a?.owner ? [a.owner] : []" placeholder="能出新版本的人" />
        </el-form-item>
        <el-form-item label="配套 Skill">
          <el-select v-model="edit.relatedSkillIds" multiple filterable clearable style="width: 100%" placeholder="市场里的 Skill">
            <el-option v-for="s in skills" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-divider content-position="left">规范（主要给品牌 VI，Agent 照这个做）</el-divider>
        <el-form-item label="颜色">
          <div class="rows">
            <div v-for="(c, i) in edit.colors" :key="i" class="row">
              <el-color-picker v-model="c.hex" size="small" />
              <el-input v-model="c.hex" placeholder="#2563eb" style="width: 110px" />
              <el-input v-model="c.name" placeholder="名称" style="width: 110px" />
              <el-input v-model="c.usage" placeholder="用在哪" />
              <el-button link type="danger" @click="edit.colors.splice(i, 1)">删</el-button>
            </div>
            <el-button size="small" @click="edit.colors.push({ name: '', hex: '#2563eb', usage: '' })">加颜色</el-button>
          </div>
        </el-form-item>
        <el-form-item label="字体">
          <div class="rows">
            <div v-for="(f, i) in edit.fonts" :key="i" class="row">
              <el-input v-model="f.name" placeholder="字体名" style="width: 140px" />
              <el-input v-model="f.usage" placeholder="用在哪" />
              <el-input v-model="f.fallback" placeholder="没有时用" style="width: 140px" />
              <el-button link type="danger" @click="edit.fonts.splice(i, 1)">删</el-button>
            </div>
            <el-button size="small" @click="edit.fonts.push({ name: '', usage: '', fallback: '' })">加字体</el-button>
          </div>
        </el-form-item>
        <el-form-item label="使用规则"><el-input v-model="edit.rules" type="textarea" :rows="3" placeholder="一行一条，如：Logo 四周留白不小于 Logo 高度的 1/4" /></el-form-item>
        <el-form-item label="文案口吻"><el-input v-model="edit.voice" type="textarea" :rows="2" placeholder="如：专业、简洁，不用感叹号" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edit.visible = false">取消</el-button>
        <el-button type="primary" :loading="edit.saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 上传新版本：沿用上一版的文件不用重新传 -->
    <el-dialog v-model="ver.visible" title="上传新版本" width="560px">
      <div v-if="a?.files.length" class="sub-title">沿用上一版的文件</div>
      <el-checkbox-group v-model="ver.keep" class="keep">
        <el-checkbox v-for="f in a?.files || []" :key="f.id" :value="f.id">{{ f.name }}</el-checkbox>
      </el-checkbox-group>
      <div class="sub-title">新增 / 替换的文件 <span class="yh-muted small">同名的会替换上一版的；单个最大 50MB</span></div>
      <input ref="fileInput" type="file" multiple @change="onPick" />
      <div v-for="f in ver.files" :key="f.name" class="yh-muted small">{{ f.name }} · {{ formatSize(f.size) }}</div>
      <el-input v-model="ver.changelog" type="textarea" :rows="2" placeholder="这一版改了什么" style="margin-top: 12px" />
      <template #footer>
        <el-button @click="ver.visible = false">取消</el-button>
        <el-button type="primary" :loading="ver.saving" @click="publish">{{ ver.saving ? ver.progress : '发布新版本' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import UserSelect from '@/components/UserSelect.vue'
import { assetApi } from '@/api/assets'
import { marketApi } from '@/api/market'
import { useUserStore } from '@/stores/user'
import { formatDateTime, copyText } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const a = ref(null)
const loading = ref(false)
const skills = ref([])
const fileInput = ref(null)
const edit = reactive({ visible: false, saving: false })
const ver = reactive({ visible: false, saving: false, keep: [], files: [], changelog: '', progress: '' })

const ext = n => (n.split('.').pop() || '').slice(0, 5).toUpperCase()
const formatSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

async function load() {
  loading.value = true
  try { a.value = await assetApi.detail(route.params.id) } finally { loading.value = false }
}
/** 下载会记成「用过这个版本」，提示随之消失 */
function downloaded() { setTimeout(load, 1500) }

async function openEdit() {
  const s = a.value.spec || {}
  Object.assign(edit, {
    visible: true, name: a.value.name, description: a.value.description || '', ownerId: a.value.owner?.id || null,
    relatedSkillIds: a.value.relatedSkills.map(x => x.id),
    colors: JSON.parse(JSON.stringify(s.colors || [])), fonts: JSON.parse(JSON.stringify(s.fonts || [])),
    rules: (s.rules || []).join('\n'), voice: s.voice || ''
  })
  if (!skills.value.length) skills.value = ((await marketApi.list({ kind: 'SKILL' }).catch(() => null))?.apps || []).map(x => ({ id: x.id, name: x.name }))
}
async function saveEdit() {
  edit.saving = true
  try {
    const spec = { colors: edit.colors, fonts: edit.fonts, rules: edit.rules.split('\n').map(x => x.trim()).filter(Boolean), voice: edit.voice }
    const body = { name: edit.name, description: edit.description, relatedSkillIds: edit.relatedSkillIds, spec }
    if (user.permissions.admin) body.ownerId = edit.ownerId
    a.value = await assetApi.update(a.value.id, body)
    edit.visible = false
    ElMessage.success('已保存')
  } finally {
    edit.saving = false
  }
}

function openVersion() {
  Object.assign(ver, { visible: true, keep: a.value.files.map(f => f.id), files: [], changelog: '' })
  if (fileInput.value) fileInput.value.value = ''
}
function onPick(e) { ver.files = [...(e.target.files || [])] }
async function publish() {
  const newNames = new Set(ver.files.map(f => f.name))
  // 沿用的文件：上一版的 sha256 原样带上（同名的被新文件替换）
  const kept = a.value.files.filter(f => ver.keep.includes(f.id) && !newNames.has(f.name))
  ver.saving = true
  try {
    const files = []
    for (const [i, f] of ver.files.entries()) {
      ver.progress = `上传 ${i + 1}/${ver.files.length}…`
      const r = await assetApi.uploadBlob(a.value.id, f)
      files.push({ name: f.name, sha256: r.sha256 })
    }
    ver.progress = '发布…'
    a.value = await assetApi.publishVersion(a.value.id, { files: [...kept.map(f => ({ name: f.name, sha256: f.sha256 })), ...files], changelog: ver.changelog })
    ver.visible = false
    ElMessage.success(`已发布 v${a.value.version}`)
  } finally {
    ver.saving = false
  }
}
async function remove() {
  await ElMessageBox.confirm(`删除「${a.value.name}」？`, '删除资料', { type: 'warning' })
  await assetApi.remove(a.value.id)
  router.push('/assets')
}
onMounted(load)
</script>

<style scoped>
.back { margin-bottom: 12px; }
.head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
.title { font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ver { font-size: 13px; font-weight: 400; }
.desc { margin: 6px 0; }
.small { font-size: 12px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.yh-card { margin-bottom: 16px; }
.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 10px; }
.swatch { display: flex; gap: 10px; align-items: center; cursor: pointer; font-size: 13px; }
.chip { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; border: 1px solid rgba(0, 0, 0, .06); }
.sub { margin-top: 14px; }
.sub-title { font-weight: 600; font-size: 13px; margin: 10px 0 6px; }
.font { font-size: 13px; line-height: 1.9; }
.rules { margin: 0; padding-left: 18px; line-height: 1.8; font-size: 13px; }
.plain { white-space: pre-wrap; font-size: 13px; line-height: 1.7; }
.files { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin-top: 10px; }
.file { display: flex; align-items: center; gap: 12px; padding: 10px; border: 1px solid var(--yh-border-soft); border-radius: 12px; }
.thumb { width: 56px; height: 56px; border-radius: 8px; background: var(--yh-bg); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; }
.thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
.ext { font-size: 11px; font-weight: 600; color: var(--yh-text-3); }
.fname { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.ver-row { padding: 6px 0; border-bottom: 1px solid var(--yh-border-soft); font-size: 13px; }
.ver-row:last-child { border-bottom: none; }
.skill { margin-top: 8px; font-size: 13px; }
.rows { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; gap: 6px; align-items: center; }
.keep { display: flex; flex-direction: column; margin-bottom: 8px; }
@media (max-width: 767px) { .cols { grid-template-columns: 1fr; } .head { flex-direction: column; } }
</style>
