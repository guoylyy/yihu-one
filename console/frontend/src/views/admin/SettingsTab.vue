<template>
  <div>
    <el-alert v-if="intro" type="info" :closable="false" show-icon class="mb">
      <template #title>{{ intro }}</template>
    </el-alert>

    <div v-loading="loading" class="groups">
      <section v-for="g in groups" :key="g.key" class="group-card">
        <div class="g-head">
          <div>
            <div class="g-title">{{ g.label }}</div>
            <div class="yh-muted small">{{ g.updatedAt ? '上次修改 ' + formatDateTime(g.updatedAt) : '未修改过，使用环境变量或默认值' }}</div>
          </div>
          <div class="yh-grow"></div>
          <span v-if="dirtyCount(g)" class="dirty-tip">{{ dirtyCount(g) }} 项未保存</span>
          <el-button v-if="g.key === 'notify'" size="small" :loading="notifyTesting" @click="testNotify">发测试消息</el-button>
          <el-button size="small" :disabled="!dirtyCount(g)" @click="resetDraft(g)">撤销</el-button>
          <el-button size="small" type="primary" :disabled="!dirtyCount(g)" :loading="saving[g.key]" @click="saveGroup(g)">保存</el-button>
        </div>

        <div class="fields">
          <div v-for="f in g.fields" :key="f.key" class="field" :class="{ wide: f.type === 'textarea' || f.type === 'list' || f.type === 'theme', dirty: isDirty(g, f) }">
            <div class="f-label">
              <span>{{ f.label }}</span>
              <el-tag :type="SOURCE[f.source]?.type || 'info'" size="small" effect="plain" class="src">
                {{ f.source === 'env' ? `环境变量 ${f.env || ''}` : SOURCE[f.source]?.label || f.source }}
              </el-tag>
              <el-button v-if="f.source === 'db' && f.type !== 'password'" link type="primary" size="small" :loading="resetting[g.key + '.' + f.key]" @click="restore(g, f)">恢复默认</el-button>
            </div>

            <div class="f-input">
              <el-switch v-if="f.type === 'bool'" v-model="draft[g.key][f.key]" />
              <div v-else-if="f.type === 'image'" class="img-field">
                <div class="img-preview" :class="{ empty: !draft[g.key][f.key] }">
                  <img v-if="draft[g.key][f.key]" :src="draft[g.key][f.key]" alt="" />
                  <span v-else>未设置</span>
                </div>
                <div class="img-actions">
                  <el-button size="small" @click="pickImage(g, f)">{{ draft[g.key][f.key] ? '更换图片' : '上传图片' }}</el-button>
                  <el-button v-if="draft[g.key][f.key]" size="small" link type="danger" @click="draft[g.key][f.key] = ''">移除</el-button>
                  <div class="yh-muted small">PNG / JPG / SVG / WebP，不超过 200KB</div>
                </div>
              </div>
              <el-input-number
                v-else-if="f.type === 'number'"
                v-model="draft[g.key][f.key]"
                :min="f.min ?? -Infinity"
                :max="f.max ?? Infinity"
                controls-position="right"
                style="width: 180px"
              />
              <el-input-tag
                v-else-if="f.type === 'list'"
                v-model="draft[g.key][f.key]"
                placeholder="输入后回车添加"
                clearable
                draggable
              />
              <el-input
                v-else-if="f.type === 'textarea'"
                v-model="draft[g.key][f.key]"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 10 }"
              />
              <div v-else-if="f.type === 'password'" class="pw">
                <el-input
                  v-model="draft[g.key][f.key]"
                  type="password"
                  show-password
                  autocomplete="new-password"
                  :disabled="!!clearing[g.key + '.' + f.key]"
                  :placeholder="clearing[g.key + '.' + f.key] ? '保存后将清除' : f.value ? '已设置，留空不修改' : '未设置'"
                />
                <el-button v-if="f.value" link :type="clearing[g.key + '.' + f.key] ? 'primary' : 'danger'" size="small" @click="toggleClear(g, f)">
                  {{ clearing[g.key + '.' + f.key] ? '撤销清除' : '清除' }}
                </el-button>
              </div>
              <ThemeEditor
                v-else-if="f.type === 'theme'"
                v-model="draft[g.key][f.key]"
                :catalog="f.catalog"
                :name="app.workspaceName"
                :logo="app.config?.logo || ''"
              />
              <div v-else-if="f.type === 'color'" class="color-field">
                <el-color-picker v-model="draft[g.key][f.key]" :predefine="PRESET_COLORS" />
                <el-input v-model="draft[g.key][f.key]" placeholder="#RRGGBB" style="width: 110px" />
              </div>
              <el-input
                v-else
                v-model="draft[g.key][f.key]"
                :placeholder="f.type === 'url' ? 'https://' : ''"
                clearable
              />
            </div>
            <div v-if="f.help" class="f-help">{{ f.help }}</div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { settingsApi } from '@/api/admin'
import { useAppStore } from '@/stores/app'
import { useAssistantStore } from '@/stores/assistant'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/format'
import { PRESET_COLORS } from '@/utils/icons'
import ThemeEditor from '@/components/ThemeEditor.vue'

const SOURCE = {
  db: { label: '后台', type: 'primary' },
  env: { label: '环境变量', type: 'warning' },
  default: { label: '默认', type: 'info' }
}

const props = defineProps({
  page: { type: String, default: 'settings' },
  intro: { type: String, default: '这些设置改了立即生效，不用改配置文件或重启。数据库连接、JWT 密钥、加密密钥、平台令牌、开发登录开关出于安全原因只在服务器环境变量里（yh 生成）。' }
})
const app = useAppStore()
const assistant = useAssistantStore()
const user = useUserStore()

const groups = ref([])
const loading = ref(false)
const draft = reactive({})
const saving = reactive({})
const resetting = reactive({})
const clearing = reactive({})

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
const IMAGE_MAX = 200 * 1024
/** 选图片 → 读成 data URL 放进草稿，点「保存」才生效 */
function pickImage(g, f) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = IMAGE_TYPES.join(',')
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return ElMessage.warning('只支持 PNG / JPG / GIF / WebP / SVG 图片')
    if (file.size > IMAGE_MAX) return ElMessage.warning(`图片 ${(file.size / 1024).toFixed(0)}KB，请压缩到 200KB 以内`)
    const reader = new FileReader()
    reader.onload = () => { draft[g.key][f.key] = reader.result }
    reader.onerror = () => ElMessage.error('读取图片失败')
    reader.readAsDataURL(file)
  }
  input.click()
}

const clone = v => (Array.isArray(v) ? [...v] : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v)
// password 草稿永远从空串开始（空 = 不修改）
/** VI 草稿 = 生效的预设 + 改过的项（老平台只改过主色的，这里看到的是「经典蓝 + 那个主色」） */
const themeDraft = f => ({ preset: f.resolved.preset, tokens: Object.fromEntries((f.resolved.custom || []).map(k => [k, f.resolved.tokens[k]])) })
const initial = f => (f.type === 'theme' ? themeDraft(f) : f.type === 'password' ? '' : f.type === 'list' ? [...(f.value || [])] : f.value ?? (f.type === 'bool' ? false : f.type === 'number' ? null : ''))

function fillDraft(g) {
  draft[g.key] = {}
  g.fields.forEach(f => { draft[g.key][f.key] = clone(initial(f)) })
  Object.keys(clearing).filter(k => k.startsWith(g.key + '.')).forEach(k => delete clearing[k])
}

function isDirty(g, f) {
  const k = g.key + '.' + f.key
  if (f.type === 'password') return !!clearing[k] || !!draft[g.key]?.[f.key]
  return JSON.stringify(draft[g.key]?.[f.key] ?? null) !== JSON.stringify(initial(f) ?? null)
}
const dirtyCount = g => g.fields.filter(f => isDirty(g, f)).length

function resetDraft(g) {
  fillDraft(g)
}

function toggleClear(g, f) {
  const k = g.key + '.' + f.key
  clearing[k] = !clearing[k]
  if (clearing[k]) draft[g.key][f.key] = ''
}

const notifyTesting = ref(false)
async function testNotify() {
  notifyTesting.value = true
  try {
    const r = await settingsApi.notifyTest()
    const ok = (r?.results || []).filter(x => x.ok).map(x => x.name).join('、')
    const bad = (r?.results || []).filter(x => !x.ok).map(x => `${x.name}：${x.error}`).join('；')
    ElMessage.success(`测试消息已发到：${ok || '无'}${bad ? `；失败：${bad}` : ''}`)
  } finally {
    notifyTesting.value = false
  }
}

async function load() {
  loading.value = true
  try {
    groups.value = (await settingsApi.list(props.page)) || []
    groups.value.forEach(fillDraft)
  } finally {
    loading.value = false
  }
}

function applyGroup(updated) {
  if (!updated || !updated.key) return load()
  const i = groups.value.findIndex(x => x.key === updated.key)
  if (i >= 0) groups.value.splice(i, 1, updated)
  fillDraft(updated)
}

// 设置影响前端：名称、功能开关、助手权限 → 刷新相关状态
async function refreshFrontend() {
  await Promise.allSettled([app.load(true), user.fetchMe(), assistant.loadStatus(true)])
}

async function saveGroup(g) {
  const body = {}
  g.fields.forEach(f => {
    if (!isDirty(g, f)) return
    const k = g.key + '.' + f.key
    if (f.type === 'password') body[f.key] = clearing[k] ? null : draft[g.key][f.key]
    else if (f.type === 'number') body[f.key] = draft[g.key][f.key] ?? null
    else if (f.type === 'list') body[f.key] = (draft[g.key][f.key] || []).map(s => String(s).trim()).filter(Boolean)
    else body[f.key] = draft[g.key][f.key]
  })
  if (!Object.keys(body).length) return
  saving[g.key] = true
  try {
    applyGroup(await settingsApi.save(g.key, body))
    ElMessage.success(`「${g.label}」已保存`)
    refreshFrontend()
  } finally {
    saving[g.key] = false
  }
}

// 恢复默认：发 null，回到环境变量值或默认值
async function restore(g, f) {
  const k = g.key + '.' + f.key
  resetting[k] = true
  try {
    applyGroup(await settingsApi.save(g.key, { [f.key]: null }))
    ElMessage.success(`「${f.label}」已恢复默认`)
    refreshFrontend()
  } finally {
    resetting[k] = false
  }
}

onMounted(load)
</script>

<style scoped>
.mb { margin-bottom: 14px; }
.img-field { display: flex; align-items: center; gap: 14px; }
.img-preview {
  width: 64px; height: 64px; border-radius: 12px; border: 1px solid var(--yh-border); background: var(--yh-fill);
  display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;
}
.img-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
.img-preview.empty { border-style: dashed; color: var(--yh-text-3); font-size: 12px; }
.img-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.small { font-size: 12px; }
.groups { display: flex; flex-direction: column; gap: 16px; min-height: 120px; }
.group-card { border: 1px solid var(--yh-border-soft); border-radius: 12px; padding: 16px 18px; background: var(--yh-card); }
.g-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--yh-border-soft); flex-wrap: wrap; }
.g-title { font-weight: 600; font-size: 15px; }
.dirty-tip { font-size: 12px; color: var(--yh-warning); }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 28px; }
.field { min-width: 0; }
.field.wide { grid-column: 1 / -1; }
.f-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; margin-bottom: 6px; flex-wrap: wrap; }
.src { font-weight: 400; }
.field.dirty .f-label > span:first-child::after { content: ' •'; color: var(--yh-warning); }
.f-input { display: flex; align-items: center; }
.f-input > * { flex: 1; }
.f-input > .el-switch, .f-input > .el-input-number { flex: 0 0 auto; }
.pw { display: flex; align-items: center; gap: 8px; }
.color-field { display: flex; align-items: center; gap: 8px; }
.f-help { font-size: 12px; color: var(--yh-text-3); margin-top: 4px; line-height: 1.5; }
@media (max-width: 900px) {
  .fields { grid-template-columns: 1fr; }
}
</style>
