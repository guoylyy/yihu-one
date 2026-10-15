<template>
  <div class="yh-page home">
    <!-- 千人千面：每个人一份自己的布局（没改过的用默认模板），可以在这里调，也可以让自己的 Agent 改 -->
    <div class="home-bar">
      <template v-if="!editing">
        <el-button size="small" text @click="startEdit">编辑首页</el-button>
        <el-button size="small" text @click="agentDlg = true">让 Agent 改首页</el-button>
      </template>
      <template v-else>
        <span class="yh-muted small">调整卡片的顺序、宽度、显示，改完点保存</span>
        <el-button size="small" @click="addDlg.visible = true">添加卡片</el-button>
        <el-button size="small" @click="useTemplate('boss')">套用：管理层</el-button>
        <el-button size="small" @click="resetHome">恢复默认</el-button>
        <el-button size="small" @click="cancelEdit">取消</el-button>
        <el-button size="small" type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </div>
    <el-alert v-if="homeError" type="warning" :closable="false" show-icon :title="`没取到你的首页布局，先显示默认首页：${homeError}`" style="margin-bottom: 12px" />

    <div class="cards">
      <template v-for="(c, i) in shownCards" :key="c.id">
        <div class="cell" :class="{ half: c.width === 'half', editing, dim: c.hidden }">
          <div v-if="editing" class="card-tools">
            <span class="tool-label">{{ cardLabel(c) }}{{ c.hidden ? '（已隐藏）' : '' }}</span>
            <el-button size="small" link :disabled="i === 0" @click="move(i, -1)">上移</el-button>
            <el-button size="small" link :disabled="i === shownCards.length - 1" @click="move(i, 1)">下移</el-button>
            <el-button size="small" link @click="c.width = c.width === 'half' ? undefined : 'half'">{{ c.width === 'half' ? '整行' : '半行' }}</el-button>
            <el-button size="small" link @click="c.hidden = !c.hidden">{{ c.hidden ? '显示' : '隐藏' }}</el-button>
            <el-button size="small" link type="danger" @click="removeCard(i)">删除</el-button>
          </div>
          <CardBoundary :title="cardLabel(c)">
            <!-- 问候 -->
            <div v-if="c.type === 'greeting'" class="greet">
              <div>
                <h1>{{ data?.greeting || defaultGreeting }}</h1>
                <div class="yh-page-sub">{{ today }}<template v-if="data"> · 工作台上有 <b class="num">{{ data.apps?.length || 0 }}</b> 个应用</template></div>
              </div>
              <el-button v-if="user.permissions.admin" :icon="Setting" @click="$router.push('/admin')">平台管理</el-button>
            </div>

            <!-- 管理员：还没配完时给一张开始清单 -->
            <section v-else-if="c.type === 'setup'" class="yh-card setup-card">
              <div class="yh-card-header">
                <div class="yh-card-title">开始配置 <span class="count">{{ setup?.done }}/{{ setup?.items.length }}</span></div>
                <span class="yh-muted small">只有管理员能看到</span>
              </div>
              <div class="setup">
                <div v-for="it in setup?.items || []" :key="it.key" class="setup-item" :class="{ done: it.done }" @click="$router.push(it.to)">
                  <span class="setup-dot"><el-icon v-if="it.done"><Check /></el-icon></span>
                  <div class="yh-grow">
                    <div class="setup-title">{{ it.title }}</div>
                    <div class="setup-desc">{{ it.desc }}</div>
                  </div>
                  <el-icon class="yh-muted"><ArrowRight /></el-icon>
                </div>
              </div>
            </section>

            <!-- AI 助手入口 -->
            <div v-else-if="c.type === 'assistant'" class="ai-hero">
              <div class="ai-hero-bg"></div>
              <div class="ai-hero-inner">
                <div class="ai-head">
                  <span class="ai-logo">✦</span>
                  <span class="ai-title">{{ assistant.status?.name || 'AI 助手' }}</span>
                  <span v-if="assistant.status?.enabled" class="ai-sub">能调用平台上各个应用的能力，说一句就行</span>
                  <span v-else-if="assistant.status" class="ai-sub off">{{ assistant.status.reason || '暂未启用' }}</span>
                </div>
                <div class="ai-input">
                  <input
                    v-model="aiText"
                    :placeholder="assistant.status?.enabled === false ? '助手暂未启用' : '例如：我能用哪些应用？'"
                    :disabled="assistant.status?.enabled === false"
                    @keydown.enter="askAi()"
                  />
                  <button :disabled="!aiText.trim()" @click="askAi()"><el-icon><Promotion /></el-icon></button>
                </div>
                <div v-if="suggestions.length" class="ai-suggest">
                  <span v-for="s in suggestions" :key="s" class="chip" @click="askAi(s)">{{ s }}</span>
                </div>
              </div>
            </div>

            <!-- 我的应用：工作台的主体 -->
            <section v-else-if="c.type === 'apps'" class="yh-card apps-card" v-loading="loading && !data">
              <div class="yh-card-header">
                <div class="yh-card-title">我的应用 <span v-if="data?.apps?.length" class="count">{{ data.apps.length }}</span></div>
                <span class="yh-link" @click="$router.push('/market')">应用市场</span>
              </div>
              <div class="apps">
                <div v-for="a in data?.apps || []" :key="a.id" class="app" :title="a.description || a.name" @click="openApp(a, $router)">
                  <div class="app-icon-wrap">
                    <AppIcon :icon="a.icon" :name="a.name" :color="a.iconColor" :size="44" />
                    <span v-if="a.hasMcp" class="app-ai" title="AI 助手可用">✦</span>
                  </div>
                  <div class="app-text">
                    <div class="app-name">{{ a.name }}</div>
                    <div class="app-desc">{{ a.description || ' ' }}</div>
                  </div>
                </div>
                <div class="app add" @click="$router.push('/market')">
                  <div class="add-box"><el-icon><Plus /></el-icon></div>
                  <div class="app-text">
                    <div class="app-name">添加应用</div>
                    <div class="app-desc">去应用市场挑选</div>
                  </div>
                </div>
              </div>
            </section>

            <!-- 单个应用的大入口 -->
            <section v-else-if="c.type === 'app'" class="yh-card one-app" @click="appOf(c) && !editing && openApp(appOf(c), $router)">
              <template v-if="appOf(c)">
                <AppIcon :icon="appOf(c).icon" :name="appOf(c).name" :color="appOf(c).iconColor" :size="52" />
                <div class="yh-grow"><div class="one-app-name">{{ appOf(c).name }}</div><div class="yh-muted small">{{ appOf(c).description }}</div></div>
                <el-icon class="yh-muted"><ArrowRight /></el-icon>
              </template>
              <span v-else class="yh-muted small">这个应用不在你的工作台上了（被移除，或你没有权限）</span>
            </section>

            <!-- 外链（只认 http/https，平台保存时校验过） -->
            <section v-else-if="c.type === 'link'" class="yh-card one-app" @click="!editing && openLink(c.url)">
              <span class="link-icon"><el-icon><Link /></el-icon></span>
              <div class="yh-grow"><div class="one-app-name">{{ c.title }}</div><div class="yh-muted small ellipsis">{{ c.url }}</div></div>
              <el-icon class="yh-muted"><ArrowRight /></el-icon>
            </section>

            <!-- 文字：纯文本 -->
            <section v-else-if="c.type === 'text'" class="yh-card">
              <div v-if="c.title" class="yh-card-title">{{ c.title }}</div>
              <div class="plain">{{ c.text }}</div>
            </section>

            <HomeDataCard v-else-if="c.type === 'data' && !editing" :card="c" />
            <OverviewCard v-else-if="['metrics', 'decisions', 'events'].includes(c.type) && !editing" :type="c.type" :title="c.title" />
            <BriefCard v-else-if="c.type === 'brief' && !editing" :title="c.title" />
            <section v-else-if="['metrics', 'decisions', 'events', 'brief'].includes(c.type)" class="yh-card"><div class="yh-card-title">{{ cardLabel(c) }}</div><div class="yh-muted small">来自各应用的经营数据</div></section>
            <section v-else-if="c.type === 'data'" class="yh-card"><div class="yh-card-title">{{ c.title }}</div><div class="yh-muted small">数据卡片 · {{ c.tool }} · {{ c.view || 'auto' }}</div></section>
          </CardBoundary>
        </div>
      </template>
    </div>

    <!-- 添加卡片（不用 Agent 的人也能自己配） -->
    <el-dialog v-model="addDlg.visible" title="添加卡片" width="560px">
      <el-form label-width="84px">
        <el-form-item label="类型">
          <el-select v-model="addDlg.type" style="width: 100%">
            <el-option v-for="t in ADDABLE" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <template v-if="addDlg.type === 'app'">
          <el-form-item label="应用">
            <el-select v-model="addDlg.appId" filterable style="width: 100%" placeholder="工作台上的应用">
              <el-option v-for="a in catalog.apps || []" :key="a.id" :label="a.name" :value="a.id" />
            </el-select>
          </el-form-item>
        </template>
        <template v-if="addDlg.type === 'link'">
          <el-form-item label="标题"><el-input v-model="addDlg.title" maxlength="40" /></el-form-item>
          <el-form-item label="地址"><el-input v-model="addDlg.url" placeholder="https://" /></el-form-item>
        </template>
        <template v-if="addDlg.type === 'text'">
          <el-form-item label="标题"><el-input v-model="addDlg.title" maxlength="40" /></el-form-item>
          <el-form-item label="文字"><el-input v-model="addDlg.text" type="textarea" :rows="4" maxlength="2000" /></el-form-item>
        </template>
        <template v-if="addDlg.type === 'data'">
          <el-form-item label="标题"><el-input v-model="addDlg.title" maxlength="40" placeholder="如：待我审批" /></el-form-item>
          <el-form-item label="数据来源">
            <el-select v-model="addDlg.tool" filterable style="width: 100%" placeholder="选一个只读工具（以你的身份调用）">
              <el-option v-for="t in catalog.tools || []" :key="t.name" :label="`${t.label || t.name}${t.appName ? '（' + t.appName + '）' : ''}`" :value="t.name" />
            </el-select>
          </el-form-item>
          <el-form-item label="参数"><el-input v-model="addDlg.args" type="textarea" :rows="2" placeholder='JSON，可不填，如 {"limit": 10}' /></el-form-item>
          <el-form-item label="显示成">
            <el-radio-group v-model="addDlg.view">
              <el-radio-button v-for="v in VIEW_LABEL" :key="v.value" :value="v.value">{{ v.label }}</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="addDlg.view === 'line'" label="字段">
            <el-input v-model="addDlg.x" placeholder="横轴，如 month" style="width: 48%" />
            <el-input v-model="addDlg.y" placeholder="纵轴，如 profit" style="width: 48%; margin-left: 4%" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="addDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="addCard">添加</el-button>
      </template>
    </el-dialog>

    <!-- 让 Agent 改首页：一段指令粘给自己的 Agent -->
    <el-dialog v-model="agentDlg" title="让 Agent 改首页" width="620px">
      <ol class="agent-steps">
        <li>先把平台接到你的 Agent（Claude Code、Codex 等）：在 <a class="yh-link" @click="$router.push('/me')">个人中心</a> 生成 API Key，按「MCP 接入说明」配置（只需一次）</li>
        <li>把下面这段话粘给它，在最后写上你想要的首页</li>
      </ol>
      <div class="agent-prompt">
        <el-button size="small" class="copy-btn" @click="copyPrompt">复制</el-button>
        <pre>{{ agentPrompt }}</pre>
      </div>
      <div class="yh-muted small">首页只有你自己能看到。改坏了随时可以在这里「编辑首页 → 恢复默认」。</div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Promotion, Setting, Check, ArrowRight, Link } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import CardBoundary from './CardBoundary.vue'
import HomeDataCard from './HomeDataCard.vue'
import OverviewCard from './OverviewCard.vue'
import BriefCard from './BriefCard.vue'
import { meApi } from '@/api/me'
import { adminApi } from '@/api/admin'
import { useUserStore } from '@/stores/user'
import { useAssistantStore } from '@/stores/assistant'
import { openApp } from '@/utils/navigate'

const user = useUserStore()
const assistant = useAssistantStore()
const data = ref(null)
const overview = ref(null)
const loading = ref(false)
const aiText = ref('')

// 默认首页（和后端 services/home.js 的 TEMPLATE 一致）：取布局失败时用它，不白屏
const TEMPLATE = [{ id: 'greeting', type: 'greeting' }, { id: 'setup', type: 'setup' }, { id: 'assistant', type: 'assistant' }, { id: 'apps', type: 'apps' }]
const TYPE_LABEL = { greeting: '问候', setup: '开始配置', assistant: 'AI 助手', apps: '我的应用', app: '应用入口', link: '链接', text: '文字', data: '数据', metrics: '关键指标', decisions: '待我决策', events: '风险与动态', brief: '最新简报' }
const ADDABLE = [
  { value: 'data', label: '数据卡片（应用里的待办、指标等）' }, { value: 'app', label: '单个应用的入口' },
  { value: 'brief', label: '最新经营简报' }, { value: 'metrics', label: '关键指标（各应用汇总）' }, { value: 'decisions', label: '待我决策（各应用汇总）' }, { value: 'events', label: '风险与动态（各应用汇总）' },
  { value: 'link', label: '链接' }, { value: 'text', label: '文字' },
  { value: 'greeting', label: '问候' }, { value: 'assistant', label: 'AI 助手' }, { value: 'apps', label: '我的应用' }, { value: 'setup', label: '开始配置（管理员）' }
]
const VIEW_LABEL = [{ value: 'auto', label: '自动' }, { value: 'number', label: '数字' }, { value: 'list', label: '列表' }, { value: 'table', label: '表格' }, { value: 'line', label: '折线' }]

const cards = ref(TEMPLATE)
const catalog = ref({})
const homeError = ref('')
const editing = ref(false)
const draft = ref([])
const saving = ref(false)
const agentDlg = ref(false)
const addDlg = reactive({ visible: false, type: 'data', appId: null, title: '', url: '', text: '', tool: '', args: '', view: 'auto', x: '', y: '' })

const today = computed(() => {
  const d = new Date()
  const w = '日一二三四五六'[d.getDay()]
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${w}`
})
const defaultGreeting = computed(() => {
  const h = new Date().getHours()
  const p = h < 6 ? '凌晨好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'
  return `${p}，${user.me?.name || ''}`
})
const suggestions = computed(() => (assistant.status?.enabled ? (assistant.status.suggestions || []).slice(0, 4) : []))
const setup = computed(() => {
  const o = overview.value
  if (!o) return null
  const items = [
    { key: 'llm', title: '配置大模型', desc: '添加一个模型，AI 助手就能用了', to: '/admin?tab=llm', done: o.models > 0 },
    { key: 'login', title: '设置登录方式', desc: '账号密码默认开启；用钉钉、飞书或企业微信的话填好应用凭证并打开', to: '/admin?tab=login', done: o.loginConfigured },
    { key: 'users', title: '添加用户', desc: '手动添加，或从钉钉同步通讯录', to: '/admin?tab=users', done: o.users > 1 },
    { key: 'apps', title: '插上第一个应用', desc: '从 Git 仓库安装，或登记一个已有系统', to: '/admin?tab=apps', done: o.apps > 0 }
  ]
  return { items, done: items.filter(i => i.done).length, todo: items.filter(i => !i.done) }
})

/** 这张卡片现在该不该出现：隐藏的、不适用的（不是管理员的开始配置、配完了的开始配置、没开助手）不显示；编辑时都显示 */
function applicable(c) {
  if (c.type === 'setup') return !!(setup.value && setup.value.todo.length)
  if (c.type === 'assistant') return user.permissions.assistant !== false
  return true
}
const shownCards = computed(() => (editing.value ? draft.value : cards.value.filter(c => !c.hidden && applicable(c))))
const cardLabel = c => c.title || TYPE_LABEL[c.type] || c.type
const appOf = c => (data.value?.apps || []).find(a => a.id === c.appId) || null
function openLink(url) { if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener') }

function askAi(text) {
  const t = (text ?? aiText.value).trim()
  if (!t) return
  aiText.value = ''
  assistant.open(t)
}

// ---------- 编辑 ----------
function startEdit() {
  draft.value = JSON.parse(JSON.stringify(cards.value))
  editing.value = true
}
function cancelEdit() { editing.value = false }
function move(i, d) {
  const a = draft.value
  ;[a[i], a[i + d]] = [a[i + d], a[i]]
}
function removeCard(i) { draft.value.splice(i, 1) }
function addCard() {
  const t = addDlg.type
  const c = { type: t }
  if (t === 'app') { if (!addDlg.appId) return ElMessage.warning('选一个应用'); c.appId = addDlg.appId }
  if (t === 'link') { Object.assign(c, { title: addDlg.title, url: addDlg.url }) }
  if (t === 'text') { Object.assign(c, { title: addDlg.title, text: addDlg.text }) }
  if (t === 'data') {
    if (!addDlg.tool) return ElMessage.warning('选一个数据来源')
    let args = {}
    if (addDlg.args.trim()) { try { args = JSON.parse(addDlg.args) } catch { return ElMessage.warning('参数要是 JSON，如 {"limit": 10}') } }
    Object.assign(c, { title: addDlg.title || '数据', tool: addDlg.tool, args, view: addDlg.view, ...(addDlg.view === 'line' ? { x: addDlg.x, y: addDlg.y } : {}) })
  }
  draft.value.push(c)
  addDlg.visible = false
  Object.assign(addDlg, { appId: null, title: '', url: '', text: '', tool: '', args: '', view: 'auto', x: '', y: '' })
}
async function saveEdit() {
  saving.value = true
  try {
    const r = await meApi.saveHome(draft.value)
    cards.value = r.cards
    editing.value = false
    ElMessage.success('首页已保存')
  } finally {
    saving.value = false
  }
}
/** 套用模板（管理层：最新简报、关键指标、待我决策、风险与动态） */
async function useTemplate(name) {
  await ElMessageBox.confirm('套用「管理层」首页？现在的卡片会被替换，之后可以接着改。', '套用模板', { type: 'warning' })
  const r = await meApi.applyHomeTemplate(name)
  cards.value = r.cards
  editing.value = false
  ElMessage.success('已套用')
}
async function resetHome() {
  await ElMessageBox.confirm('恢复成默认首页？你加的卡片会删掉。', '恢复默认', { type: 'warning' })
  const r = await meApi.resetHome()
  cards.value = r.cards
  editing.value = false
}

const agentPrompt = [
  '帮我改一下我在以虎 One 的首页（用已经接好的以虎 One MCP）：',
  '1. 先调 get_my_home，看现在的布局、我能放的应用（catalog.apps）和能当数据来源的只读工具（catalog.tools）。',
  '2. 按我下面说的需求重新安排卡片。需要显示数据的，用 data 卡片：先自己调一次那个工具看返回的结构，再定 view（数字 / 列表 / 表格 / 折线）和字段；参数尽量带上筛选，只取前 10 条左右。',
  '3. 保存前用一两句话告诉我新首页从上到下是什么样，我同意后再用 set_my_home 保存。没有合适工具的需求直接告诉我，不要编数据。',
  '我想要的首页：'
].join('\n')
async function copyPrompt() {
  await navigator.clipboard.writeText(agentPrompt)
  ElMessage.success('已复制，粘贴给你的 Agent，再写上你想要的首页')
}

async function load() {
  loading.value = true
  try {
    const [wb, ov, h] = await Promise.all([
      meApi.workbench(),
      user.permissions.admin ? adminApi.overview().catch(() => null) : null,
      meApi.home().catch(e => { homeError.value = e.message || '出错了'; return null })
    ])
    data.value = wb
    overview.value = ov
    if (h?.cards?.length) { cards.value = h.cards; catalog.value = h.catalog || {} }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  if (user.permissions.assistant !== false) assistant.loadStatus()
})
</script>

<style scoped>
.greet { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.greet h1 { margin: 0; font-size: 24px; font-weight: 600; }
.num { color: var(--yh-primary); }
.num.danger { color: var(--yh-danger); }

/* AI hero */
.ai-hero { position: relative; border-radius: 16px; overflow: hidden; margin-bottom: 20px; }
.ai-hero-bg {
  position: absolute; inset: 0;
  background: var(--yh-hero-ai);
}
.ai-hero-inner { position: relative; padding: 22px 24px 20px; color: var(--yh-on-primary); }
.ai-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ai-logo {
  width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, .16); border: 1px solid rgba(255, 255, 255, .25);
}
.ai-title { font-weight: 600; font-size: 16px; }
.ai-sub { font-size: 13px; opacity: .75; }
.ai-sub.off { color: #fde68a; opacity: 1; }
.ai-input {
  margin-top: 14px; display: flex; align-items: center; gap: 8px; background: var(--yh-card); border-radius: 12px; padding: 6px 6px 6px 16px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .25);
}
.ai-input input { flex: 1; border: none; outline: none; font-size: 15px; background: transparent; color: var(--yh-text); min-width: 0; height: 36px; font-family: inherit; }
.ai-input input::placeholder { color: #9ca3af; }
.ai-input button {
  width: 38px; height: 38px; border: none; border-radius: 10px; cursor: pointer; color: var(--yh-on-primary); font-size: 17px;
  background: var(--yh-gradient); display: flex; align-items: center; justify-content: center;
}
.ai-input button:disabled { opacity: .4; cursor: not-allowed; }
.ai-suggest { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.chip {
  font-size: 12.5px; padding: 5px 12px; border-radius: 999px; cursor: pointer;
  background: rgba(255, 255, 255, .12); border: 1px solid rgba(255, 255, 255, .22); transition: background .15s;
}
.chip:hover { background: rgba(255, 255, 255, .22); }

/* 开始配置 */
.setup-card { margin-bottom: 16px; }
.setup { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.setup-item {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; cursor: pointer;
  border: 1px solid var(--yh-border-soft); transition: all .15s;
}
.setup-item:hover { border-color: var(--el-color-primary-light-7); background: var(--yh-fill); }
.setup-dot {
  width: 22px; height: 22px; border-radius: 50%; border: 2px solid #cbd5e1; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center; color: var(--yh-on-primary); font-size: 12px;
}
.setup-item.done .setup-dot { background: var(--yh-success); border-color: var(--yh-success); }
.setup-item.done .setup-title { color: var(--yh-text-3); text-decoration: line-through; }
.setup-title { font-weight: 500; font-size: 14px; }
.setup-desc { font-size: 12px; color: var(--yh-text-3); margin-top: 2px; }
.small { font-size: 12px; }

/* 我的应用 */
.apps-card { margin-bottom: 16px; }
.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
.app {
  display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; cursor: pointer;
  border: 1px solid var(--yh-border-soft); transition: all .15s; min-width: 0;
}
.app:hover { border-color: var(--el-color-primary-light-7); background: var(--yh-fill); box-shadow: 0 4px 12px rgba(var(--yh-primary-rgb), .08); }
.app:hover .app-name { color: var(--yh-primary); }
.app-icon-wrap { position: relative; flex-shrink: 0; }
.app-ai {
  position: absolute; right: -4px; top: -4px; width: 16px; height: 16px; border-radius: 50%; font-size: 9px; color: var(--yh-on-primary);
  background: var(--yh-gradient); display: flex; align-items: center; justify-content: center; border: 2px solid var(--yh-card);
}
.app-text { min-width: 0; flex: 1; }
.app-name { font-size: 14px; font-weight: 500; color: var(--yh-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-desc { font-size: 12px; color: var(--yh-text-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app.add { border-style: dashed; }
.add-box { width: 44px; height: 44px; border-radius: 12px; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; color: var(--yh-text-3); }

@media (max-width: 767px) {
  .greet h1 { font-size: 20px; }
  .greet .el-button { display: none; }
  .ai-hero-inner { padding: 16px; }
  .ai-sub { display: none; }
  .apps { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 4px; }
  .app, .app.add { flex-direction: column; text-align: center; gap: 6px; padding: 4px 0; border: none; }
  .app:hover { background: none; box-shadow: none; }
  .app-name { font-size: 12px; font-weight: 400; color: var(--yh-text-2); }
  .app-desc { display: none; }
}

/* 千人千面：卡片网格 */
.home-bar { display: flex; justify-content: flex-end; align-items: center; gap: 6px; margin: -8px 0 6px; flex-wrap: wrap; }
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.cell { grid-column: span 2; min-width: 0; }
.cell.half { grid-column: span 1; }
.cell.editing { outline: 1px dashed var(--el-color-primary-light-5); border-radius: 14px; padding: 6px; margin-bottom: 12px; }
.cell.dim { opacity: .45; }
.cell > section, .cell > .ai-hero, .cell > .greet { margin-bottom: 16px; }
.card-tools { display: flex; align-items: center; gap: 2px; margin-bottom: 6px; flex-wrap: wrap; }
.tool-label { font-size: 12px; color: var(--yh-text-3); margin-right: 8px; }
.one-app { display: flex; align-items: center; gap: 14px; cursor: pointer; }
.one-app:hover .one-app-name { color: var(--yh-primary); }
.one-app-name { font-size: 15px; font-weight: 600; }
.link-icon { width: 44px; height: 44px; border-radius: 12px; background: var(--yh-primary-soft); color: var(--yh-primary); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
.plain { white-space: pre-wrap; line-height: 1.7; margin-top: 6px; }
.agent-steps { padding-left: 20px; line-height: 1.9; font-size: 13px; margin: 0 0 12px; }
.agent-prompt { position: relative; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; }
.agent-prompt pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.7; }
.agent-prompt .copy-btn { position: absolute; top: 8px; right: 8px; }
@media (max-width: 767px) {
  .cell.half { grid-column: span 2; }
}
</style>
