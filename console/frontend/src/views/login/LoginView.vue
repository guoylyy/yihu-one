<template>
  <div class="login-page">
    <div class="login-side">
      <div class="side-inner">
        <BrandLogo class="side-logo" reversed />
        <h1>{{ appCfg.workspaceName }}</h1>
        <p class="side-desc">所有应用，一个入口、一次登录。<br />每个人都有一位能调用各个应用的 AI 助手。</p>
        <ul class="side-points">
          <li><span>✓</span> 统一登录，应用之间不用再记密码</li>
          <li><span>✓</span> 应用随时插拔，推送代码自动上线</li>
          <li><span>✦</span> AI 助手自动获得每个应用的能力</li>
        </ul>
      </div>
      <div class="side-foot">{{ appCfg.companyName }}</div>
    </div>

    <div class="login-main">
      <div class="login-card">
        <div class="m-brand">
          <BrandLogo class="side-logo small" />
          <span>{{ appCfg.workspaceName }}</span>
        </div>
        <h2>登录</h2>
        <p class="yh-muted sub">{{ subText }}</p>

        <div v-if="loadingConfig" class="state"><el-icon class="is-loading"><Loading /></el-icon> 正在加载…</div>

        <!-- 钉钉客户端内免登 -->
        <div v-else-if="inDing && config?.dingtalk?.enabled" class="state">
          <template v-if="inappError">
            <el-alert type="error" :title="inappError" :closable="false" show-icon />
            <el-button type="primary" size="large" class="block-btn" style="margin-top: 16px" @click="inappLogin">重试</el-button>
          </template>
          <template v-else><el-icon class="is-loading"><Loading /></el-icon> 正在通过钉钉免登…</template>
        </div>

        <!-- 飞书 / 企业微信客户端内：跳授权页，静默通过 -->
        <div v-else-if="inAppProvider" class="state">
          <el-icon class="is-loading"><Loading /></el-icon> 正在通过{{ inAppProvider === 'feishu' ? '飞书' : '企业微信' }}免登…
        </div>

        <template v-else-if="config">
          <el-form v-if="config.passwordLogin" class="pw-form" @submit.prevent="passwordLogin">
            <el-input v-model="pw.username" size="large" placeholder="账号" autocomplete="username" :prefix-icon="User" />
            <el-input v-model="pw.password" size="large" type="password" show-password placeholder="密码" autocomplete="current-password" :prefix-icon="Lock" @keydown.enter="passwordLogin" />
            <el-button type="primary" size="large" class="block-btn" native-type="submit" :loading="pw.loading" :disabled="!pw.username || !pw.password">登录</el-button>
          </el-form>

          <div v-if="config.passwordLogin && providers.length" class="divider"><span>或</span></div>
          <div class="providers" :class="{ many: providers.length > 1 }">
            <el-button
              v-for="p in providers"
              :key="p.key"
              size="large"
              class="block-btn provider-btn"
              :class="p.key"
              @click="p.go"
            >
              <span class="p-mark">{{ p.mark }}</span>{{ p.label }}
            </el-button>
          </div>
          <el-alert v-if="!config.passwordLogin && !providers.length && !config.devLogin" type="warning" :closable="false" show-icon title="没有可用的登录方式，请联系管理员" />

          <div v-if="config.devLogin" class="dev-login">
            <div class="divider"><span>开发登录</span></div>
            <el-select
              v-model="devUserId"
              filterable
              placeholder="搜索姓名 / 部门，选择即登录"
              size="large"
              style="width: 100%"
              :loading="devLoading"
              :filter-method="filterDev"
              @change="devLogin"
              @visible-change="v => v && (devKeyword = '')"
            >
              <el-option v-for="u in filteredDevUsers" :key="u.id" :label="u.name" :value="u.id">
                <div class="dev-opt">
                  <span class="name">{{ u.name }}</span>
                  <span class="meta">{{ [u.dept, u.title].filter(Boolean).join(' · ') }}</span>
                </div>
              </el-option>
            </el-select>
            <div class="dev-tip">仅测试模式可见（yh init --test）</div>
          </div>
        </template>

        <el-alert v-if="configError" type="error" :title="configError" :closable="false" show-icon style="margin-top: 12px">
          <el-button link type="primary" @click="loadConfig">重试</el-button>
        </el-alert>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Loading, User, Lock } from '@element-plus/icons-vue'
import { authApi } from '@/api/auth'
import BrandLogo from '@/components/BrandLogo.vue'
import { useUserStore } from '@/stores/user'
import { useAppStore } from '@/stores/app'
import { isDingTalk, requestInAppAuthCode, buildScanLoginUrl, saveLoginRedirect, safeRedirect, goRedirect } from '@/utils/dingtalk'
import { isFeishu, isWecom, feishuAuthUrl, wecomQrUrl, wecomInAppUrl, newState } from '@/utils/oauth'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const appCfg = useAppStore()

const config = ref(null)
const loadingConfig = ref(true)
const configError = ref('')
const inDing = isDingTalk()
const inappError = ref('')

// 可用的第三方登录（按配置显示）
const providers = computed(() => {
  const c = config.value || {}
  return [
    c.dingtalk?.enabled && { key: 'dingtalk', label: '钉钉扫码登录', mark: '钉', go: scanLogin },
    c.feishu?.enabled && { key: 'feishu', label: '飞书登录', mark: '飞', go: () => goOAuth('feishu') },
    c.wecom?.enabled && { key: 'wecom', label: '企业微信登录', mark: '企', go: () => goOAuth('wecom') }
  ].filter(Boolean)
})
// 在飞书 / 企业微信客户端里打开：直接走静默授权
const inAppProvider = computed(() => {
  const c = config.value || {}
  if (isFeishu() && c.feishu?.enabled) return 'feishu'
  if (isWecom() && c.wecom?.enabled) return 'wecom'
  return null
})

function goOAuth(provider, inApp = false) {
  const state = newState()
  saveLoginRedirect(redirect.value, state)
  const c = config.value
  window.location.href = provider === 'feishu' ? feishuAuthUrl(c.feishu, state) : inApp ? wecomInAppUrl(c.wecom, state) : wecomQrUrl(c.wecom, state)
}

const devUsers = ref([])
const devUserId = ref(null)
const devLoading = ref(false)
const devKeyword = ref('')

const redirect = computed(() => safeRedirect(route.query.redirect))
const pw = reactive({ username: '', password: '', loading: false })
const subText = computed(() => {
  const c = config.value
  if (!c) return ''
  const names = [c.dingtalk?.enabled && '钉钉', c.feishu?.enabled && '飞书', c.wecom?.enabled && '企业微信'].filter(Boolean).join(' / ')
  if (c.passwordLogin && names) return `使用平台账号或${names}登录`
  if (names) return `使用${names}账号登录，无需单独注册`
  return '使用管理员分配的账号登录'
})

const filteredDevUsers = computed(() => {
  const k = devKeyword.value.trim().toLowerCase()
  if (!k) return devUsers.value
  return devUsers.value.filter(u => [u.name, u.dept, u.title].filter(Boolean).join(' ').toLowerCase().includes(k))
})
function filterDev(k) { devKeyword.value = k || '' }

async function loadConfig() {
  loadingConfig.value = true
  configError.value = ''
  try {
    config.value = await authApi.config()
    appCfg.config = config.value
    if (inDing && config.value?.dingtalk?.enabled) {
      inappLogin()
    } else if (inAppProvider.value) {
      goOAuth(inAppProvider.value, true)
    }
    if (config.value?.devLogin) loadDevUsers()
  } catch (e) {
    configError.value = '无法连接服务器：' + (e.message || '')
  } finally {
    loadingConfig.value = false
  }
}

async function loadDevUsers() {
  devLoading.value = true
  try {
    devUsers.value = (await authApi.devUsers()) || []
  } catch {
    /* 已提示 */
  } finally {
    devLoading.value = false
  }
}

async function finishLogin(res) {
  user.applyLogin(res)
  if (!res.user) await user.fetchMe()
  ElMessage.success(`欢迎，${user.me?.name || ''}`)
  goRedirect(router, redirect.value)
}

async function passwordLogin() {
  if (!pw.username || !pw.password || pw.loading) return
  pw.loading = true
  try {
    await finishLogin(await authApi.passwordLogin(pw.username.trim(), pw.password))
  } catch {
    pw.password = ''
  } finally {
    pw.loading = false
  }
}

async function inappLogin() {
  inappError.value = ''
  try {
    const code = await requestInAppAuthCode(config.value.dingtalk.corpId)
    const res = await authApi.inappLogin(code)
    await finishLogin(res)
  } catch (e) {
    inappError.value = e.message || '钉钉免登失败'
  }
}

function scanLogin() {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36)
  saveLoginRedirect(redirect.value, state)
  window.location.href = buildScanLoginUrl(config.value.dingtalk.clientId, state)
}

async function devLogin(id) {
  if (!id) return
  try {
    const res = await authApi.devLogin(id)
    await finishLogin(res)
  } catch {
    devUserId.value = null
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.login-page { display: flex; min-height: 100vh; background: var(--yh-card); }
.login-side {
  width: 44%; max-width: 560px; padding: 56px 56px 32px; color: var(--yh-on-primary); display: flex; flex-direction: column; justify-content: space-between;
  background: var(--yh-hero);
}
.side-inner { margin-top: 10vh; }
.side-logo {
  width: 52px; height: 52px; border-radius: 14px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.3);
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 26px; color: var(--yh-on-primary);
}
.side-logo.small { width: 34px; height: 34px; font-size: 17px; border-radius: 9px; background: var(--yh-primary); color: var(--yh-on-primary); border: none; }
h1 { font-size: 32px; margin: 28px 0 12px; font-weight: 800; letter-spacing: 1px; }
.side-desc { font-size: 16px; line-height: 1.8; opacity: .9; margin: 0; }
.side-points { list-style: none; padding: 0; margin: 36px 0 0; display: flex; flex-direction: column; gap: 14px; font-size: 14px; opacity: .92; }
.side-points span { display: inline-flex; width: 22px; height: 22px; border-radius: 50%; background: rgba(255,255,255,.18); align-items: center; justify-content: center; margin-right: 10px; font-size: 12px; }
.side-foot { font-size: 12px; opacity: .6; }

.login-main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--yh-bg); }
.login-card { width: 100%; max-width: 400px; background: var(--yh-card); border: 1px solid var(--yh-border); border-radius: var(--yh-radius); padding: 36px 32px; box-shadow: var(--yh-shadow-lg); }
.m-brand { display: none; }
h2 { margin: 0; font-size: 22px; }
.sub { margin: 6px 0 28px; font-size: 13px; }
.state { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--yh-text-2); padding: 20px 0; }
.state .el-alert { width: 100%; }
.block-btn { width: 100%; height: 46px; font-size: 15px; border-radius: var(--yh-radius-sm); }
.providers { display: flex; flex-direction: column; gap: 10px; }
.providers .el-button + .el-button { margin-left: 0; }
.provider-btn { color: #fff; border: none; }
.provider-btn .p-mark { display: inline-flex; width: 22px; height: 22px; border-radius: 6px; background: rgba(255,255,255,.22); align-items: center; justify-content: center; font-size: 12px; font-weight: 600; margin-right: 8px; }
.provider-btn.dingtalk { background: #0089ff; }
.provider-btn.dingtalk:hover { background: #1a95ff; }
.provider-btn.feishu { background: #3370ff; }
.provider-btn.feishu:hover { background: #4c83ff; }
.provider-btn.wecom { background: #0082ef; }
.provider-btn.wecom:hover { background: #2a95f2; }
.pw-form { display: flex; flex-direction: column; gap: 12px; }
.pw-form .block-btn { margin-top: 4px; }
.pw-form + .divider { margin: 18px 0 14px; }
.dev-login { margin-top: 20px; }
.divider { display: flex; align-items: center; gap: 12px; color: var(--yh-text-3); font-size: 12px; margin-bottom: 14px; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--yh-border); }
.dev-opt { display: flex; justify-content: space-between; gap: 16px; }
.dev-opt .meta { color: var(--yh-text-3); font-size: 12px; }
.dev-tip { font-size: 12px; color: var(--yh-text-3); margin-top: 8px; text-align: center; }

@media (max-width: 767px) {
  .login-side { display: none; }
  .login-main { align-items: flex-start; padding-top: 12vh; }
  .login-card { box-shadow: none; background: transparent; padding: 12px 8px; }
  .m-brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 17px; margin-bottom: 28px; }
}
</style>
