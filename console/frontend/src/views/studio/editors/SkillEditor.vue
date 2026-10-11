<template>
  <div class="form-pane">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 18px">
      <template #title>
        Skill 是一个文件夹，根目录要有 <code>SKILL.md</code>，开头写 <code>name</code> 和 <code>description</code>（Claude Code、Codex 等 Agent 通用的格式）。
        上传 ZIP 或整个文件夹；也可以直接让你的 Agent 通过 MCP 上传，见 <a href="/dev/skills" target="_blank">Skill 中心</a>。
      </template>
    </el-alert>

    <div class="pickers">
      <el-button type="primary" plain @click="zipInput.click()">上传 ZIP</el-button>
      <el-button plain @click="dirInput.click()">上传文件夹</el-button>
      <span class="yh-muted small">最多 100 个文件、合计 1MB；不能包含可执行文件（.exe、.so 等），脚本可以</span>
      <input ref="zipInput" type="file" accept=".zip,application/zip" hidden @change="onZip" />
      <input ref="dirInput" type="file" webkitdirectory multiple hidden @change="onDir" />
    </div>

    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon style="margin-top: 14px" />

    <template v-if="files.length">
      <el-alert v-if="!meta" type="warning" :closable="false" show-icon style="margin-top: 14px" title="没有找到根目录的 SKILL.md，发布前要补上" />
      <el-alert v-else-if="!meta.name || !meta.description" type="warning" :closable="false" show-icon style="margin-top: 14px"
        title="SKILL.md 开头的 frontmatter 要写 name（小写字母、数字、短横线）和 description，发布时会检查" />
      <div v-else class="meta">
        <div><span class="k">name</span><code>{{ meta.name }}</code><span v-if="meta.version" class="yh-muted small">　version {{ meta.version }}</span></div>
        <div><span class="k">description</span>{{ meta.description }}</div>
      </div>

      <div class="section-title">文件 <span class="yh-muted">{{ files.length }} 个 · {{ formatSize(total) }}</span></div>
      <div class="files">
        <div v-for="f in files" :key="f.path" class="file" :class="{ active: f.path === preview }" @click="preview = f.path">
          <span class="path">{{ f.path }}</span><span class="yh-muted small">{{ formatSize(f.size) }}</span>
        </div>
      </div>
      <!-- 用户上传的内容，当纯文本显示，不渲染 HTML -->
      <pre v-if="previewText !== null" class="preview">{{ previewText }}</pre>
      <div v-else-if="preview" class="yh-muted small preview-empty">二进制文件，不预览</div>
    </template>
    <div v-else class="empty yh-muted">还没有内容：上传一个 Skill 的 ZIP 或文件夹</div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useDraft } from './useDraft'
import { readZip, readFolder, skillMeta, textOf, formatSize } from '@/utils/skillFiles'

const props = defineProps({ app: { type: Object, required: true } })
const emit = defineEmits(['saving'])
const { payload } = useDraft(props.app, emit, {
  init: p => { if (!Array.isArray(p.files)) p.files = [] },
  pick: p => ({ files: p.files })
})

const zipInput = ref(null)
const dirInput = ref(null)
const error = ref('')
const files = computed(() => payload.value.files || [])
const total = computed(() => files.value.reduce((n, f) => n + (f.size || 0), 0))
const meta = computed(() => skillMeta(files.value))
const preview = ref('SKILL.md')
const previewText = computed(() => {
  const f = files.value.find(x => x.path === preview.value)
  return f ? textOf(f) : null
})

async function load(read) {
  error.value = ''
  try {
    const list = await read()
    if (!list.length) throw new Error('里面没有文件')
    if (list.length > 100) throw new Error(`文件太多（${list.length} 个，最多 100 个）`)
    payload.value.files = list
    preview.value = list.some(f => f.path === 'SKILL.md') ? 'SKILL.md' : list[0].path
  } catch (e) {
    error.value = `读取失败：${e.message || e}`
  }
}
function onZip(e) {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (f) load(() => readZip(f))
}
function onDir(e) {
  const list = [...(e.target.files || [])]
  e.target.value = ''
  if (list.length) load(() => readFolder(list))
}
</script>

<style scoped>
.form-pane { max-width: 900px; padding: 20px 24px 40px; }
.small { font-size: 12px; }
.pickers { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.meta { margin-top: 14px; background: var(--yh-bg); border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.9; }
.meta .k { display: inline-block; width: 92px; color: var(--yh-text-3); }
.section-title { margin: 18px 0 8px; font-weight: 600; font-size: 14px; }
.files { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; max-height: 240px; overflow: auto; }
.file { display: flex; justify-content: space-between; gap: 12px; padding: 7px 12px; font-size: 13px; cursor: pointer; border-bottom: 1px solid var(--el-border-color-extra-light); }
.file:last-child { border-bottom: none; }
.file:hover { background: var(--yh-bg); }
.file.active { background: var(--yh-primary-soft); }
.path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.preview { margin-top: 12px; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 14px 16px; font-size: 12.5px; line-height: 1.6; max-height: 420px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
.preview-empty { margin-top: 12px; }
.empty { margin-top: 28px; text-align: center; padding: 36px 0; border: 1px dashed var(--el-border-color); border-radius: 12px; }
</style>
