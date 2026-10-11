<template>
  <div class="lite" v-loading="loading && !boot">
    <header v-if="boot" class="bar">
      <el-button text @click="back"><el-icon><ArrowLeft /></el-icon></el-button>
      <AppIcon :icon="boot.app.icon" :name="boot.app.name" :color="boot.app.iconColor" :size="26" />
      <div class="yh-grow" style="min-width: 0">
        <div class="name yh-ellipsis">{{ boot.app.name }}
          <el-tag v-if="boot.preview" size="small" type="warning">预览 {{ boot.version }}</el-tag>
        </div>
        <div class="by yh-ellipsis">轻应用 · {{ boot.publisher ? `${boot.publisher.name} 发布` : '' }}</div>
      </div>
      <el-button v-if="boot.isPublisher && !boot.preview" text @click="$router.push(`/studio/${boot.app.id}`)">编辑</el-button>
      <el-button text @click="$router.push(`/market/${boot.app.id}`)">详情</el-button>
    </header>

    <div v-if="error" class="yh-empty err">{{ error }}</div>

    <!-- 第一次打开别人发布、要用 AI 或工具的轻应用：先确认 -->
    <div v-else-if="boot?.needGrant" class="grant">
      <div class="grant-card">
        <AppIcon :icon="boot.app.icon" :name="boot.app.name" :color="boot.app.iconColor" :size="52" />
        <div class="g-title">「{{ boot.app.name }}」想要</div>
        <ul>
          <li>在平台上保存它自己的数据（只有这个应用能读写）</li>
          <li v-if="boot.needGrant.ai">以你的名义调用 AI 模型（计入你每天的额度）</li>
          <li v-for="t in boot.needGrant.tools" :key="t.name">以你的身份调用「{{ t.label }}」（只读）<span v-if="!t.available" class="yh-muted">——你没有这个工具的权限，调用会失败</span></li>
        </ul>
        <div v-if="boot.needGrant.changed" class="yh-muted small">这个应用更新后申请的权限变了，需要重新确认</div>
        <div class="yh-muted small">发布者：{{ boot.publisher?.name || '—' }}。它拿不到你的登录凭证，也不能访问外网。</div>
        <div class="g-actions">
          <el-button @click="back">不用了</el-button>
          <el-button type="primary" :loading="granting" @click="grant">同意并打开</el-button>
        </div>
      </div>
    </div>

    <div v-else-if="boot" class="frame-wrap">
      <LiteFrame :app-id="boot.app.id" :html="boot.html" :version-id="versionId" :app="boot.app" :user="boot.user" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import LiteFrame from '@/components/LiteFrame.vue'
import { liteApi } from '@/api/market'

const route = useRoute()
const router = useRouter()
const boot = ref(null)
const loading = ref(false)
const error = ref('')
const granting = ref(false)
const versionId = route.query.version ? Number(route.query.version) : null

async function load() {
  loading.value = true
  error.value = ''
  try {
    boot.value = await liteApi.bootstrap(route.params.id, versionId)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function grant() {
  granting.value = true
  try {
    await liteApi.grant(boot.value.app.id)
    await load()
  } finally {
    granting.value = false
  }
}

function back() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

onMounted(load)
</script>

<style scoped>
.lite { height: 100%; display: flex; flex-direction: column; background: var(--yh-card); }
.bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--yh-border-soft); }
.name { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }
.by { font-size: 12px; color: var(--yh-text-3); }
.frame-wrap { flex: 1; min-height: 0; }
.err { margin-top: 12vh; }
.grant { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--yh-bg); }
.grant-card { max-width: 440px; width: 100%; background: var(--yh-card); border-radius: 16px; padding: 28px; box-shadow: var(--yh-shadow-lg); text-align: center; }
.g-title { font-size: 17px; font-weight: 600; margin: 14px 0 8px; }
.grant-card ul { text-align: left; font-size: 13px; line-height: 1.9; padding-left: 20px; margin: 0 0 12px; }
.g-actions { display: flex; justify-content: center; gap: 10px; margin-top: 18px; }
.small { font-size: 12px; margin-top: 6px; }
</style>
