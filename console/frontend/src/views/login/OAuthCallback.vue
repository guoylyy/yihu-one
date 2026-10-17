<template>
  <div class="cb">
    <div class="cb-card">
      <template v-if="!error">
        <el-icon class="is-loading" :size="28" color="var(--yh-primary)"><Loading /></el-icon>
        <div class="cb-text">正在登录…</div>
      </template>
      <template v-else>
        <el-result icon="error" title="登录失败" :sub-title="error">
          <template #extra>
            <el-button type="primary" @click="$router.replace({ name: 'Login', query: { redirect } })">返回登录</el-button>
          </template>
        </el-result>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loading } from '@element-plus/icons-vue'
import { authApi } from '@/api/auth'
import { useUserStore } from '@/stores/user'
import { takeLoginRedirect, safeRedirect, goRedirect } from '@/utils/dingtalk'
import { callbackUrl } from '@/utils/oauth'

// 钉钉 / 飞书 / 企业微信授权回来都落到这里：/auth/<平台>/callback?code&state
const LOGIN = {
  dingtalk: code => authApi.scanLogin(code),
  feishu: code => authApi.feishuLogin(code, callbackUrl('feishu')),
  wecom: code => authApi.wecomLogin(code)
}

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const error = ref('')
const redirect = ref('/')

onMounted(async () => {
  const saved = takeLoginRedirect()
  redirect.value = safeRedirect(saved.redirect)
  const provider = String(route.params.provider || 'dingtalk')
  // 钉钉新版 OAuth 回调参数为 authCode；飞书、企业微信是 code
  const authCode = route.query.authCode || route.query.code
  const state = route.query.state
  if (!authCode) {
    error.value = route.query.error_description || route.query.error || '缺少授权码，可能是取消了授权，请重新登录'
    return
  }
  if (saved.state && state && saved.state !== state) {
    error.value = '登录状态校验失败，请重新扫码'
    return
  }
  try {
    if (!LOGIN[provider]) throw new Error('不支持的登录方式')
    const res = await LOGIN[provider](String(authCode))
    user.applyLogin(res)
    if (!res.user) await user.fetchMe()
    goRedirect(router, redirect.value)
  } catch (e) {
    error.value = e.message || '登录失败'
  }
})
</script>

<style scoped>
.cb { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--yh-bg); }
.cb-card { text-align: center; }
.cb-text { margin-top: 12px; color: var(--yh-text-2); }
</style>
