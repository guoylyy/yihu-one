<template>
  <div class="yh-page market">
    <div class="yh-page-header">
      <div>
        <h2 class="yh-page-title">应用市场</h2>
        <div class="yh-page-sub">同事们做的 AI 助手、轻应用和业务系统，装到自己的工作台上用。你也可以<a class="yh-link" @click="$router.push('/studio')">自己做一个</a></div>
      </div>
      <el-input v-model="keyword" placeholder="搜索应用、标签" clearable :prefix-icon="Search" class="search" @input="onSearch" />
    </div>

    <div class="filters">
      <div class="kinds">
        <span v-for="k in kinds" :key="k.value" class="kind" :class="{ active: kind === k.value }" @click="kind = k.value; load()">{{ k.label }}</span>
      </div>
      <div class="yh-grow"></div>
      <el-select v-model="sort" style="width: 130px" @change="load">
        <el-option label="最多人用" value="hot" />
        <el-option label="评分最高" value="rating" />
        <el-option label="最近更新" value="new" />
      </el-select>
    </div>
    <div v-if="categories.length" class="cats">
      <span class="cat" :class="{ active: !category }" @click="category = ''; load()">全部分类</span>
      <span v-for="c in categories" :key="c" class="cat" :class="{ active: category === c }" @click="category = c; load()">{{ c }}</span>
    </div>

    <div v-loading="loading" class="sections">
      <section v-if="shared.length" class="section">
        <div class="section-title">分享给我的 <span class="yh-muted">{{ shared.length }}</span></div>
        <div class="grid">
          <AppCard v-for="a in shared" :key="a.id" :app="a" @toggle="toggle" />
        </div>
      </section>
      <section v-if="mine.length" class="section">
        <div class="section-title">我发布的 <span class="yh-muted">{{ mine.length }}</span><a class="yh-link small" @click="$router.push('/studio')">去创作中心</a></div>
        <div class="grid">
          <AppCard v-for="a in mine" :key="a.id" :app="a" @toggle="toggle" />
        </div>
      </section>
      <section class="section">
        <div class="section-title">{{ category || (kind ? kindLabel : '全部应用') }} <span class="yh-muted">{{ listed.length }}</span></div>
        <div v-if="!loading && !listed.length" class="yh-card yh-empty">
          {{ keyword || kind || category ? '没有找到匹配的应用' : '市场里还没有应用' }}
          <div style="margin-top: 10px"><el-button type="primary" plain @click="$router.push('/studio')">做第一个</el-button></div>
        </div>
        <div class="grid">
          <AppCard v-for="a in listed" :key="a.id" :app="a" @toggle="toggle" />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import AppCard from './AppCard.vue'
import { marketApi } from '@/api/market'
import { appApi } from '@/api/apps'
import { useUserStore } from '@/stores/user'
import { APP_KIND } from '@/utils/constants'

const user = useUserStore()
const apps = ref([])
const categories = ref([])
const loading = ref(false)
const keyword = ref('')
const kind = ref('')
const category = ref('')
const sort = ref('hot')

const kinds = [{ value: '', label: '全部' }, ...['AGENT', 'LITE', 'SKILL', 'EXTERNAL', 'HOSTED'].map(k => ({ value: k, label: APP_KIND[k].label }))]
const kindLabel = computed(() => APP_KIND[kind.value]?.label || '')
const isMine = a => a.publisher?.id === user.me?.id
const mine = computed(() => apps.value.filter(a => isMine(a) && a.scope !== 'MARKET'))
const shared = computed(() => apps.value.filter(a => a.scope === 'SHARED' && !isMine(a)))
const listed = computed(() => apps.value.filter(a => a.scope === 'MARKET'))

async function load() {
  loading.value = true
  try {
    const r = await marketApi.list({ q: keyword.value, kind: kind.value, category: category.value, sort: sort.value })
    apps.value = r?.apps || []
    if (!category.value) categories.value = r?.categories || []
  } finally {
    loading.value = false
  }
}

let timer = null
function onSearch() {
  clearTimeout(timer)
  timer = setTimeout(load, 300)
}

async function toggle(a) {
  if (a.installed) {
    await appApi.uninstall(a.id)
    a.installed = false
    a.installs = Math.max(0, a.installs - 1)
    ElMessage.success('已从工作台移除')
  } else {
    await appApi.install(a.id)
    a.installed = true
    a.installs++
    ElMessage.success('已添加到工作台')
  }
}

onMounted(load)
</script>

<style scoped>
.search { max-width: 260px; }
.filters { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.kinds { display: flex; gap: 4px; background: var(--yh-fill-3); padding: 3px; border-radius: 10px; }
.kind { padding: 6px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; color: var(--yh-text-2); }
.kind.active { background: var(--yh-card); color: var(--yh-text); font-weight: 500; box-shadow: var(--yh-shadow); }
.cats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.cat { font-size: 12.5px; padding: 3px 12px; border-radius: 999px; border: 1px solid var(--yh-border); cursor: pointer; color: var(--yh-text-2); background: var(--yh-card); }
.cat.active { border-color: var(--yh-primary); color: var(--yh-primary); background: var(--yh-primary-soft); }
.sections { min-height: 200px; }
.section + .section { margin-top: 26px; }
.section-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.small { font-size: 12px; font-weight: 400; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
@media (max-width: 767px) {
  .grid { grid-template-columns: 1fr; gap: 10px; }
  .search { max-width: none; width: 100%; }
}
</style>
