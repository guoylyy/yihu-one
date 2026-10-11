<template>
  <div class="yh-page assets">
    <div class="yh-page-header">
      <div>
        <h2 class="yh-page-title">资料</h2>
        <div class="yh-page-sub">公司的模板、品牌 VI、设计组件。可以直接下载用，也可以让你的 Agent 按公司规范帮你做（资料是素材，Skill 是做法）</div>
      </div>
      <div class="yh-flex">
        <el-button @click="agentDlg = true">让 Agent 按公司规范做</el-button>
        <el-button v-if="user.permissions.admin" type="primary" :icon="Plus" @click="createDlg.visible = true">新建资料</el-button>
      </div>
    </div>

    <div class="filters">
      <div class="cats">
        <span class="cat" :class="{ active: !category }" @click="category = ''; load()">全部</span>
        <span v-for="(label, k) in CATEGORIES" :key="k" class="cat" :class="{ active: category === k }" @click="category = k; load()">{{ label }}</span>
      </div>
      <el-input v-model="keyword" placeholder="搜索资料" clearable :prefix-icon="Search" style="width: 220px" @change="load" @clear="load" />
    </div>

    <div v-loading="loading" class="grid">
      <div v-if="!loading && !list.length" class="empty yh-muted">{{ keyword || category ? '没有找到匹配的资料' : '还没有资料' + (user.permissions.admin ? '，点右上角「新建资料」上传公司的模板和品牌 VI' : '') }}</div>
      <div v-for="a in list" :key="a.id" class="yh-card card" @click="$router.push(`/assets/${a.id}`)">
        <div class="cover">
          <img v-if="a.cover" :src="a.cover" alt="" />
          <span v-else class="cover-icon">{{ ICON[a.category] }}</span>
        </div>
        <div class="body">
          <div class="name">{{ a.name }}</div>
          <div class="desc yh-muted">{{ a.description || ' ' }}</div>
          <div class="meta yh-muted">
            <el-tag size="small" effect="plain">{{ a.categoryLabel }}</el-tag>
            <span>{{ a.version ? 'v' + a.version : '还没有文件' }}</span>
            <el-tag v-if="a.updateAvailable" size="small" type="warning">有新版本</el-tag>
          </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="createDlg.visible" title="新建资料" width="480px">
      <el-form label-width="72px">
        <el-form-item label="类别">
          <el-radio-group v-model="createDlg.category">
            <el-radio-button v-for="(label, k) in CATEGORIES" :key="k" :value="k">{{ label }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="createDlg.name" maxlength="100" placeholder="如：公司 PPT 模板 2026" /></el-form-item>
        <el-form-item label="简介"><el-input v-model="createDlg.description" type="textarea" :rows="2" maxlength="1000" /></el-form-item>
      </el-form>
      <div class="yh-muted small">建好后在详情页上传文件、填品牌规范、指定责任人。</div>
      <template #footer>
        <el-button @click="createDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="createDlg.saving" @click="create">创建并编辑</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="agentDlg" title="让 Agent 按公司规范做" width="620px">
      <div class="yh-muted small" style="margin-bottom: 10px">先在 <a class="yh-link" @click="$router.push('/me')">个人中心</a> 把平台接到你的 Agent（只需一次），再把这段话粘给它，后面写上要做什么：</div>
      <div class="agent-prompt">
        <el-button size="small" class="copy-btn" @click="copy">复制</el-button>
        <pre>{{ agentPrompt }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { assetApi } from '@/api/assets'
import { useUserStore } from '@/stores/user'

const CATEGORIES = { TEMPLATE: '模板', BRAND: '品牌 VI', COMPONENT: '设计组件', OTHER: '其他' }
const ICON = { TEMPLATE: '📑', BRAND: '🎨', COMPONENT: '🧩', OTHER: '📦' }
const router = useRouter()
const user = useUserStore()
const list = ref([])
const loading = ref(false)
const category = ref('')
const keyword = ref('')
const agentDlg = ref(false)
const createDlg = reactive({ visible: false, saving: false, category: 'TEMPLATE', name: '', description: '' })

const agentPrompt = [
  '请按以虎 One 上的公司规范帮我做东西（用已经接好的以虎 One MCP）：',
  '1. 先调 get_brand_guidelines，拿公司的颜色、字体、使用规则、文案口吻和可用的模板。颜色和字体严格按返回的 spec，不要自己编。',
  '2. 要用模板（比如 PPT）就用 get_asset 取模板文件，在模板的基础上做；Logo 等文件用返回的 url 下载（15 分钟内有效）。',
  '3. 做完告诉我用了哪份资料的哪个版本。',
  '我要做的是：'
].join('\n')

async function load() {
  loading.value = true
  try { list.value = await assetApi.list({ category: category.value || undefined, keyword: keyword.value || undefined }) } finally { loading.value = false }
}
async function create() {
  createDlg.saving = true
  try {
    const a = await assetApi.create({ category: createDlg.category, name: createDlg.name, description: createDlg.description })
    createDlg.visible = false
    router.push(`/assets/${a.id}`)
  } finally {
    createDlg.saving = false
  }
}
async function copy() {
  await navigator.clipboard.writeText(agentPrompt)
  ElMessage.success('已复制，粘贴给你的 Agent，再写上要做什么')
}
onMounted(load)
</script>

<style scoped>
.filters { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.cats { display: flex; gap: 4px; background: var(--yh-fill-3); padding: 3px; border-radius: 10px; }
.cat { padding: 5px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; color: var(--yh-text-2); }
.cat.active { background: var(--yh-card); color: var(--yh-primary); font-weight: 500; box-shadow: 0 1px 3px rgba(0, 0, 0, .06); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; min-height: 120px; }
.empty { grid-column: 1 / -1; text-align: center; padding: 48px 0; }
.card { padding: 0; overflow: hidden; cursor: pointer; transition: box-shadow .15s; }
.card:hover { box-shadow: 0 8px 24px rgba(15, 23, 42, .08); }
.cover { height: 128px; background: var(--yh-bg); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.cover img { max-width: 100%; max-height: 100%; object-fit: contain; }
.cover-icon { font-size: 40px; }
.body { padding: 12px 14px 14px; }
.name { font-weight: 600; font-size: 14px; }
.desc { font-size: 12px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-top: 8px; }
.small { font-size: 12px; }
.agent-prompt { position: relative; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 14px 16px; }
.agent-prompt pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.7; }
.agent-prompt .copy-btn { position: absolute; top: 8px; right: 8px; }
</style>
