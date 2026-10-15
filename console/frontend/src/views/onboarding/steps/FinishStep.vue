<template>
  <div class="ob-form">
    <div class="sum">
      <div v-for="it in items" :key="it.key" class="sum-row" :class="it.state">
        <span class="sum-dot">{{ it.state === 'done' ? '✓' : it.state === 'skipped' ? '–' : '!' }}</span>
        <div class="yh-grow">
          <b>{{ it.title }}</b>
          <div class="yh-muted small">{{ it.detail }}</div>
        </div>
        <el-button v-if="it.key !== 'account'" link type="primary" @click="$emit('goto', it.key)">{{ it.state === 'done' ? '修改' : '去配置' }}</el-button>
      </div>
    </div>

    <div class="ob-section next">
      <div class="ob-section-title">接下来</div>
      <div class="ob-box brief">
        <div class="yh-grow">
          <b>开通我的每日经营简报</b>
          <div class="yh-muted small">工作日早上 8 点，老板助理把关键数字、风险和等你决定的事推到你的手机（时间可以在个人中心改）。开通后马上生成第一份</div>
        </div>
        <el-tag v-if="brief" type="success">已开通</el-tag>
        <el-button v-else type="primary" :disabled="!status.facts.models" :loading="creating" @click="createBrief">开通</el-button>
      </div>
      <div class="ob-tip">
        <ul>
          <li>把访问地址 <code>{{ status.facts.publicBaseUrl }}</code> 发给大家；钉钉 / 飞书 / 企业微信里也可以从工作台打开</li>
          <li>管理员和部门负责人默认用「管理层」首页；其他人在首页「编辑首页」里换</li>
          <li>以后随时可以从「管理」页回到这个向导</li>
        </ul>
      </div>
    </div>

    <div class="ob-btns">
      <el-button type="primary" size="large" :loading="completing" @click="complete">{{ status.completedAt ? '回工作台' : '完成开通' }}</el-button>
      <el-button size="large" @click="report">下载开通报告</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { onboardingApi } from '@/api/admin'
import { meApi } from '@/api/me'
import { useUserStore } from '@/stores/user'

const props = defineProps({ status: { type: Object, required: true } })
const emit = defineEmits(['changed', 'goto'])
const router = useRouter()
const user = useUserStore()
const brief = ref(null)
const creating = ref(false)
const completing = ref(false)

const TITLES = { account: '管理员账号', company: '公司信息', theme: '外观', models: '大模型', login: '登录方式', people: '人员', notify: '消息通知', apps: '应用' }
const items = computed(() => {
  const f = props.status.facts
  const im = Object.entries({ dingtalk: '钉钉', feishu: '飞书', wecom: '企业微信' }).filter(([k]) => f.im[k]).map(([, v]) => v)
  const detail = {
    account: `${user.me?.name || ''}（管理员）`,
    company: [f.workspaceName, f.companyName, f.timezone].filter(Boolean).join(' · '),
    theme: '平台外观和 LOGO',
    models: f.models ? `${f.models} 个对话模型${f.embModels ? `、${f.embModels} 个向量模型` : '，没有向量模型（知识库检索用）'}` : '还没有模型：AI 助手和简报用不了',
    login: [f.passwordLogin && '账号密码', ...im].filter(Boolean).join('、') || '—',
    people: `${f.people} 人`,
    notify: im.length ? `个人消息走${im.join(' / ')}` : '没有开钉钉 / 飞书 / 企业微信，个人消息发不出去',
    apps: `${f.apps} 个应用`
  }
  return props.status.steps.filter(s => s.key !== 'finish').map(s => ({
    key: s.key, title: TITLES[s.key], detail: detail[s.key], state: s.done ? 'done' : s.skipped ? 'skipped' : 'todo'
  }))
})

async function createBrief() {
  creating.value = true
  try {
    brief.value = await meApi.createBrief({ kind: 'weekdays', time: '08:00' })
    ElMessage.success('已开通，第一份简报正在生成，几分钟后在首页和 AI 助手里能看到')
  } finally {
    creating.value = false
  }
}

async function complete() {
  completing.value = true
  try {
    if (!props.status.completedAt) await onboardingApi.complete()
    emit('changed')
    router.push('/')
  } finally {
    completing.value = false
  }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
/** 开通报告：一页 HTML，交付时留档 / 打印 */
function report() {
  const f = props.status.facts
  const STATE = { done: '已配好', skipped: '已跳过', todo: '未配置' }
  const rows = items.value.map(it => `<tr><td>${esc(it.title)}</td><td class="${it.state}">${STATE[it.state]}</td><td>${esc(it.detail)}</td></tr>`).join('')
  const now = new Date().toLocaleString('zh-CN', { hour12: false })
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(f.workspaceName)} 开通报告</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#222;line-height:1.7}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border:1px solid #ddd;padding:8px 10px;text-align:left;font-size:14px}th{background:#f5f5f5}.done{color:#15803d}.skipped{color:#b45309}.todo{color:#b91c1c}.meta{color:#666;font-size:13px}</style></head><body>
<h1>${esc(f.workspaceName)} 开通报告</h1>
<div class="meta">${esc(f.companyName || '')} · 访问地址 ${esc(f.publicBaseUrl)} · 生成于 ${esc(now)} · 管理员 ${esc(user.me?.name || '')}</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${rows}</table>
<p class="meta">没配好的项目可以随时在平台「管理 → 开通向导」里继续。</p></body></html>`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  a.download = `${f.workspaceName || '平台'}-开通报告.html`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

onMounted(async () => {
  try { brief.value = await meApi.latestBrief() } catch { /* 没开通 */ }
})
</script>

<style scoped>
@import '../onboarding.css';
.sum { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
.sum-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid var(--yh-border); border-radius: var(--yh-radius); }
.sum-dot { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; border: 1px solid var(--yh-border); }
.sum-row.done .sum-dot { background: var(--yh-success); border-color: var(--yh-success); color: var(--yh-on-primary); }
.sum-row.skipped .sum-dot { color: var(--yh-warning); border-color: var(--yh-warning); }
.sum-row.todo .sum-dot { color: var(--yh-danger); border-color: var(--yh-danger); }
.brief { display: flex; align-items: center; gap: 12px; }
.small { font-size: 12px; }
</style>
