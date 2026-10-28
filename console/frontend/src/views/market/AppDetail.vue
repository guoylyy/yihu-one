<template>
  <div class="yh-page detail" v-loading="loading">
    <div class="back"><a class="yh-link" @click="$router.back()">‹ 返回</a></div>
    <template v-if="app">
      <div class="yh-card head">
        <AppIcon :icon="app.icon" :name="app.name" :color="app.iconColor" :size="72" />
        <div class="yh-grow" style="min-width: 0">
          <div class="title">
            {{ app.name }}
            <span class="kind" :style="{ color: kindMeta.color, borderColor: kindMeta.color + '40' }">{{ kindMeta.label }}</span>
            <el-tag v-if="app.scope !== 'MARKET'" size="small" :type="APP_SCOPE[app.scope]?.type">{{ APP_SCOPE[app.scope]?.label }}</el-tag>
          </div>
          <div class="desc">{{ app.description || '暂无简介' }}</div>
          <div class="meta">
            <span v-if="app.publisher" class="yh-flex"><UserAvatar :user="app.publisher" :size="20" />{{ app.publisher.name }} 发布</span>
            <span v-if="app.rating" class="stars">★ {{ app.rating }} <span class="yh-muted">（{{ app.ratingCount }} 人评分）</span></span>
            <span>{{ app.installs }} 人在用</span>
            <span v-if="app.category">{{ app.category }}</span>
            <span v-if="app.version">v{{ app.version }}</span>
            <el-tag v-for="t in app.tags" :key="t" size="small" effect="plain" round>{{ t }}</el-tag>
          </div>
        </div>
        <div class="actions">
          <!-- Skill 不在平台上打开：交给自己的 Agent 或下载 -->
          <template v-if="isSkill">
            <el-button type="primary" size="large" :disabled="!app.usable" @click="copyInstall">复制给 Agent 的安装指令</el-button>
            <el-button size="large" :disabled="!skill" @click="download">下载 ZIP</el-button>
          </template>
          <template v-else>
            <el-button type="primary" size="large" :disabled="!app.usable" @click="openApp(app, $router)">打开</el-button>
            <el-button v-if="app.installed" size="large" @click="toggle">已添加到工作台</el-button>
            <el-button v-else size="large" :disabled="!app.usable" @click="toggle">添加到工作台</el-button>
          </template>
          <el-button v-if="app.isPublisher" size="large" text @click="$router.push(`/studio/${app.id}`)">编辑</el-button>
        </div>
      </div>

      <div class="body">
        <div class="main">
          <section v-if="app.screenshots?.length" class="yh-card">
            <div class="shots">
              <el-image v-for="(s, i) in app.screenshots" :key="i" :src="s" :preview-src-list="app.screenshots" :initial-index="i" fit="cover" class="shot" preview-teleported />
            </div>
          </section>
          <section v-if="isSkill && skill" class="yh-card">
            <div class="yh-card-header">
              <div class="yh-card-title">文件 <span class="yh-muted small">{{ skill.files.length }} 个 · {{ skill.version }} · 指纹 {{ skill.digest }}</span></div>
            </div>
            <div class="skill-files">
              <span v-for="f in skill.files" :key="f.path" class="skill-file" :class="{ active: f.path === skillPreview }" @click="skillPreview = f.path">{{ f.path }}</span>
            </div>
            <!-- 发布者上传的内容，当纯文本显示，不渲染 HTML -->
            <pre v-if="skillPreviewText !== null" class="skill-preview">{{ skillPreviewText }}</pre>
            <div v-else class="yh-muted small">二进制文件，不预览</div>
          </section>
          <section class="yh-card">
            <div class="yh-card-title">介绍</div>
            <div v-if="app.intro" class="md" v-html="renderMarkdown(app.intro)"></div>
            <div v-else class="yh-muted">{{ app.description || '发布者还没写介绍' }}</div>
          </section>
          <section class="yh-card">
            <div class="yh-card-header">
              <div class="yh-card-title">评价 <span class="yh-muted small">{{ app.ratingCount }}</span></div>
            </div>
            <div v-if="!app.isPublisher" class="my-rate">
              <el-rate v-model="myStars" />
              <el-input v-model="myComment" placeholder="说说好不好用、哪里要改（选填）" maxlength="1000" />
              <el-button type="primary" :disabled="!myStars" :loading="rating" @click="saveRating">{{ app.myRating ? '更新评价' : '提交' }}</el-button>
            </div>
            <div v-if="!app.ratings.length" class="yh-muted small empty">还没有评价</div>
            <div v-for="(r, i) in app.ratings" :key="i" class="rating">
              <UserAvatar :user="r.user" :size="28" />
              <div class="yh-grow">
                <div class="r-head"><b>{{ r.user?.name }}</b><span class="stars">{{ '★'.repeat(r.stars) }}<span class="off">{{ '★'.repeat(5 - r.stars) }}</span></span><span class="yh-muted small">{{ fromNow(r.updatedAt) }}</span></div>
                <div v-if="r.comment" class="r-body">{{ r.comment }}</div>
              </div>
            </div>
          </section>
        </div>

        <aside class="side">
          <section class="yh-card">
            <div class="yh-card-title">它能做什么</div>
            <ul class="perms">
              <li v-for="(p, i) in app.permissions" :key="i">{{ p }}</li>
            </ul>
          </section>
          <section class="yh-card">
            <div class="yh-card-title">版本记录</div>
            <div v-if="!app.versions.length" class="yh-muted small">暂无</div>
            <div v-for="v in app.versions" :key="v.id" class="ver">
              <div><b>{{ v.version }}</b> <span class="yh-muted small">{{ formatDate(v.date) }}</span></div>
              <div v-if="v.changelog" class="yh-muted small">{{ v.changelog }}</div>
            </div>
          </section>
          <div class="report"><a class="yh-link small" @click="report">举报这个应用</a></div>
        </aside>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { marketApi } from '@/api/market'
import { appApi } from '@/api/apps'
import { APP_KIND, APP_SCOPE } from '@/utils/constants'
import { openApp } from '@/utils/navigate'
import { renderMarkdown } from '@/utils/markdown'
import { fromNow, formatDate } from '@/utils/format'
import { downloadZip, textOf } from '@/utils/skillFiles'

const route = useRoute()
const app = ref(null)
const loading = ref(false)
const myStars = ref(0)
const myComment = ref('')
const rating = ref(false)
const kindMeta = computed(() => APP_KIND[app.value?.kind] || { label: '', color: '#64748b' })

// Skill：看文件、下载、复制一段给自己 Agent 的安装指令（Agent 经 MCP 的 get_skill 取文件）
const isSkill = computed(() => app.value?.kind === 'SKILL')
const skill = ref(null)
const skillPreview = ref('SKILL.md')
const skillPreviewText = computed(() => {
  const f = skill.value?.files.find(x => x.path === skillPreview.value)
  return f ? textOf(f) : null
})
async function loadSkill() {
  if (!isSkill.value || !app.value.usable) return
  skill.value = await marketApi.skillFiles(app.value.id)
  if (!skill.value.files.some(f => f.path === skillPreview.value)) skillPreview.value = skill.value.files[0]?.path
}
function download() {
  downloadZip(skill.value.name, skill.value.files)
}
async function copyInstall() {
  const base = window.location.origin
  const name = skill.value?.name || app.value.name
  const text = [
    `请帮我安装以虎 One 上的 Skill「${name}」：`,
    `1. 用以虎 One 的 MCP（${base}/api/mcp，用我的 API Key 认证）调用 get_skill，参数 skill = "${app.value.id}"。`,
    `2. 把返回的 files 按 path 原样写进本地 Skill 目录（Claude Code 是 ~/.claude/skills/${name}/，其他 Agent 用它自己的 Skill 目录）；目录已存在时先问我要不要覆盖。`,
    '3. 记下返回的 version 和 digest，以后我说「检查 Skill 更新」时用 check_skill_updates 对比。',
    `还没接入以虎 One 的 MCP 的话：在 ${base}/me 生成 API Key，按页面上的说明把这个 MCP 加到你的配置里。`
  ].join('\n')
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制，粘贴给你的 Agent（Claude Code、Codex 等）')
}

async function load() {
  loading.value = true
  try {
    app.value = await marketApi.detail(route.params.id)
    myStars.value = app.value.myRating?.stars || 0
    myComment.value = app.value.myRating?.comment || ''
  } finally {
    loading.value = false
  }
  await loadSkill()
}

async function toggle() {
  if (app.value.installed) {
    await appApi.uninstall(app.value.id)
    ElMessage.success('已从工作台移除')
  } else {
    await appApi.install(app.value.id)
    ElMessage.success('已添加到工作台')
  }
  load()
}

async function saveRating() {
  rating.value = true
  try {
    await marketApi.rate(app.value.id, { stars: myStars.value, comment: myComment.value })
    ElMessage.success('谢谢你的评价')
    load()
  } finally {
    rating.value = false
  }
}

async function report() {
  let reason
  try {
    ({ value: reason } = await ElMessageBox.prompt('哪里有问题？管理员会看到并处理（可能下架这个应用）', '举报', {
      confirmButtonText: '提交', cancelButtonText: '取消', inputType: 'textarea',
      inputValidator: v => (v && v.trim().length >= 4) || '请写清楚一点'
    }))
  } catch {
    return
  }
  await marketApi.report(app.value.id, reason)
  ElMessage.success('已提交，管理员会尽快处理')
}

onMounted(load)
</script>

<style scoped>
.detail { max-width: 1100px; }
.back { margin-bottom: 10px; font-size: 13px; }
.head { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
.title { font-size: 22px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kind { font-size: 12px; font-weight: 500; border: 1px solid; border-radius: 4px; padding: 0 6px; line-height: 20px; }
.desc { color: var(--yh-text-2); margin-top: 6px; }
.meta { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin-top: 12px; font-size: 13px; color: var(--yh-text-2); }
.stars { color: #f59e0b; }
.stars .off { color: #e5e7eb; }
.actions { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.actions .el-button + .el-button { margin-left: 0; }
.skill-files { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.skill-file { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; padding: 3px 8px; border-radius: 6px; background: var(--yh-bg); cursor: pointer; }
.skill-file.active { background: var(--yh-primary-soft); color: var(--yh-primary); }
.skill-preview { background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 14px 16px; font-size: 12.5px; line-height: 1.6; max-height: 460px; overflow: auto; white-space: pre-wrap; word-break: break-word; margin: 0; }
.body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; margin-top: 16px; align-items: start; }
.main .yh-card + .yh-card, .side .yh-card + .yh-card { margin-top: 16px; }
.shots { display: flex; gap: 10px; overflow-x: auto; }
.shot { width: 240px; height: 150px; border-radius: 8px; border: 1px solid var(--yh-border-soft); flex-shrink: 0; cursor: zoom-in; }
.md { font-size: 14px; line-height: 1.8; color: var(--yh-text); }
.md :deep(h2), .md :deep(h3) { font-size: 15px; margin: 14px 0 6px; }
.md :deep(ul) { padding-left: 20px; }
.my-rate { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.my-rate .el-input { flex: 1; min-width: 200px; }
.empty { padding: 8px 0; }
.rating { display: flex; gap: 10px; padding: 10px 0; border-top: 1px solid var(--yh-border-soft); }
.r-head { display: flex; gap: 10px; align-items: center; font-size: 13px; }
.r-body { font-size: 13px; margin-top: 4px; color: var(--yh-text-2); white-space: pre-wrap; }
.perms { margin: 8px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.9; color: var(--yh-text-2); }
.ver { padding: 6px 0; font-size: 13px; border-top: 1px solid var(--yh-border-soft); }
.ver:first-of-type { border-top: none; }
.report { text-align: center; margin-top: 12px; }
.small { font-size: 12px; }
@media (max-width: 900px) {
  .body { grid-template-columns: 1fr; }
  .actions { flex-direction: row; width: 100%; }
}
</style>
