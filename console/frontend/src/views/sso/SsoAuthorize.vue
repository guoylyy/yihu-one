<template>
  <div class="sso">
    <div class="sso-card">
      <div class="logos">
        <BrandLogo class="logo main" />
        <div class="dots"><i></i><i></i><i></i></div>
        <AppIcon :icon="app?.icon" :name="app?.name || '应用'" :color="app?.iconColor" :size="52" />
      </div>

      <template v-if="error">
        <div class="title">无法完成登录</div>
        <el-alert type="error" :title="error" :closable="false" show-icon style="margin-top: 16px; text-align: left" />
        <el-button style="margin-top: 20px" @click="$router.replace('/')">返回工作台</el-button>
      </template>
      <!-- 员工发布的应用：第一次登录先确认它能拿到哪些信息 -->
      <template v-else-if="consent">
        <div class="title">「{{ app?.name }}」想要</div>
        <ul class="items">
          <li v-for="i in consent.items" :key="i">读取{{ i }}</li>
          <li v-if="consent.tools">给 AI 助手提供工具（以你自己的身份和权限执行）</li>
        </ul>
        <div class="sub">发布者：{{ consent.publisher?.name || '—' }}<template v-if="consent.changed"> · 应用申请的信息变了，需要重新确认</template></div>
        <div class="consent-actions">
          <el-button :loading="declining" @click="decline">不同意</el-button>
          <el-button type="primary" :loading="agreeing" @click="go(true)">同意并继续</el-button>
        </div>
      </template>
      <template v-else>
        <div class="title">正在登录 {{ app?.name || '应用' }}</div>
        <div class="sub">
          使用 <b>{{ user.me?.name }}</b> 的{{ appCfg.workspaceName }}身份
          <span v-if="app?.description" class="desc">{{ app.description }}</span>
        </div>
        <div class="loading"><el-icon class="is-loading"><Loading /></el-icon> {{ stage }}</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loading } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { ssoApi } from '@/api/sso'
import { useUserStore } from '@/stores/user'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const appCfg = useAppStore()
appCfg.load()
const app = ref(null)
const error = ref('')
const stage = ref('正在校验应用…')
const consent = ref(null)
const agreeing = ref(false)
const declining = ref(false)

// 标准 OAuth2 / OIDC 客户端（GitLab、Grafana 等）会带这些参数，原样交给后端；平台 SDK 不带
const STANDARD_PARAMS = ['response_type', 'scope', 'nonce', 'code_challenge', 'code_challenge_method']
function request(extra) {
  const q = route.query
  const body = { client_id: q.client_id, redirect_uri: q.redirect_uri, state: q.state || '', ...extra }
  for (const k of STANDARD_PARAMS) if (q[k]) body[k] = String(q[k])
  return body
}

async function go(agree = false) {
  agreeing.value = agree
  try {
    const res = await ssoApi.authorize(request({ consent: agree || undefined }))
    if (!res?.redirect) throw new Error('授权失败：未返回跳转地址')
    window.location.replace(res.redirect)
  } catch (e) {
    consent.value = null
    error.value = e.message || '授权失败'
  } finally {
    agreeing.value = false
  }
}

/** 不同意：标准客户端要带 error=access_denied 跳回去（它们才知道用户取消了）；平台 SDK 的应用回工作台 */
async function decline() {
  if (!route.query.response_type) return router.replace('/')
  declining.value = true
  try {
    const res = await ssoApi.authorize(request({ deny: true }))
    window.location.replace(res.redirect)
  } catch {
    router.replace('/')
  }
}

onMounted(async () => {
  const { client_id: clientId, redirect_uri: redirectUri, state } = route.query
  if (!clientId || !redirectUri) {
    error.value = '缺少 client_id 或 redirect_uri 参数'
    return
  }
  try {
    app.value = await ssoApi.appInfo(String(clientId))
  } catch (e) {
    error.value = e.message || '应用不存在或已停用'
    return
  }
  try {
    const c = await ssoApi.consent(String(clientId))
    if (c?.needConsent) {
      consent.value = c.needConsent
      return
    }
  } catch (e) {
    error.value = e.message || '授权失败'
    return
  }
  stage.value = '正在授权，即将跳转…'
  go(false)
})
</script>

<style scoped>
.sso { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--yh-bg); padding: 16px; }
.sso-card { width: 100%; max-width: 420px; background: var(--yh-card); border-radius: 16px; padding: 40px 32px; text-align: center; box-shadow: var(--yh-shadow-lg); }
.logos { display: flex; align-items: center; justify-content: center; gap: 16px; }
.logo.main { width: 52px; height: 52px; border-radius: 14px; background: var(--yh-primary); color: var(--yh-on-primary); font-weight: 700; font-size: 24px; display: flex; align-items: center; justify-content: center; }
.dots { display: flex; gap: 5px; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--el-color-primary-light-7); animation: b 1.2s infinite; }
.dots i:nth-child(2) { animation-delay: .2s; }
.dots i:nth-child(3) { animation-delay: .4s; }
@keyframes b { 0%, 100% { background: var(--el-color-primary-light-7); } 50% { background: var(--yh-primary); } }
.title { font-size: 18px; font-weight: 600; margin-top: 24px; }
.sub { color: var(--yh-text-2); margin-top: 8px; font-size: 13px; }
.items { text-align: left; font-size: 13px; line-height: 1.9; margin: 14px 0 6px; padding-left: 20px; }
.consent-actions { display: flex; justify-content: center; gap: 10px; margin-top: 20px; }
.desc { display: block; color: var(--yh-text-3); margin-top: 4px; }
.loading { margin-top: 24px; color: var(--yh-text-3); display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; }
</style>
