<template>
  <div class="setup-page">
    <div class="setup-side">
      <div class="side-inner">
        <BrandLogo class="side-logo" reversed />
        <h1>欢迎使用以虎 One</h1>
        <p class="side-desc">三分钟完成初始化，<br />马上拥有一个可插拔应用的企业工作台。</p>
        <ul class="side-points">
          <li><span>✓</span> 应用随时插拔，统一登录</li>
          <li><span>✓</span> AI 助手自动获得每个应用的能力</li>
          <li><span>✦</span> 之后可在「管理 → 登录方式」接入钉钉 / 飞书 / 企业微信</li>
        </ul>
      </div>
    </div>

    <div class="setup-main">
      <div class="setup-card">
        <el-steps :active="step" align-center finish-status="success" class="steps">
          <el-step title="管理员账号" />
          <el-step title="站点信息" />
          <el-step title="完成" />
        </el-steps>

        <el-form v-if="step === 0" :model="admin" :rules="adminRules" ref="adminForm" label-position="top" class="form">
          <el-form-item label="登录账号" prop="username">
            <el-input v-model="admin.username" placeholder="2~50 位字母、数字、下划线、点或短横线" autocomplete="username" />
          </el-form-item>
          <el-form-item label="姓名" prop="name">
            <el-input v-model="admin.name" placeholder="管理员的姓名" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="admin.password" type="password" show-password placeholder="至少 8 位，需包含字母和数字" autocomplete="new-password" />
          </el-form-item>
          <el-form-item label="确认密码" prop="confirm">
            <el-input v-model="admin.confirm" type="password" show-password placeholder="再输一遍" autocomplete="new-password" @keydown.enter="next" />
          </el-form-item>
        </el-form>

        <el-form v-else-if="step === 1" :model="site" label-position="top" class="form">
          <el-form-item label="平台名称">
            <el-input v-model="site.workspaceName" placeholder="登录页、侧边栏显示的名称，默认「以虎 One」" maxlength="60" />
          </el-form-item>
          <el-form-item label="平台英文名">
            <el-input v-model="site.workspaceSubtitle" placeholder="侧边栏名称下面那行小字，留空则不显示" maxlength="60" />
          </el-form-item>
        </el-form>

        <div v-else class="finish">
          <el-alert
            type="success"
            :closable="false"
            show-icon
            title="马上就好"
            description="点击「完成初始化」将创建管理员账号，并预置一个通用 AI 助手。之后可在「管理 → 登录方式」里配置钉钉 / 飞书 / 企业微信登录。"
          />
        </div>

        <div class="actions">
          <el-button v-if="step > 0" @click="step--">上一步</el-button>
          <el-button v-if="step < 2" type="primary" @click="next">下一步</el-button>
          <el-button v-else type="primary" :loading="submitting" @click="submit">完成初始化</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { setupApi } from '@/api/setup'
import { useAppStore } from '@/stores/app'
import BrandLogo from '@/components/BrandLogo.vue'

const router = useRouter()
const app = useAppStore()
const step = ref(0)
const submitting = ref(false)
const adminForm = ref(null)
const admin = reactive({ username: '', name: '', password: '', confirm: '' })
const site = reactive({ workspaceName: '', workspaceSubtitle: '' })

const validateConfirm = (_rule, value, cb) => {
  if (value !== admin.password) cb(new Error('两次输入的密码不一致'))
  else cb()
}
const adminRules = {
  username: [
    { required: true, message: '请填写登录账号', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_.-]{2,50}$/, message: '2~50 位字母、数字、下划线、点或短横线', trigger: 'blur' }
  ],
  name: [{ required: true, message: '请填写姓名', trigger: 'blur' }],
  password: [
    { required: true, message: '请填写密码', trigger: 'blur' },
    { pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/, message: '至少 8 位，需同时包含字母和数字', trigger: 'blur' }
  ],
  confirm: [
    { required: true, message: '请再输一遍密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' }
  ]
}

async function next() {
  if (step.value === 0) {
    try {
      await adminForm.value.validate()
    } catch {
      return
    }
  }
  step.value++
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  try {
    await setupApi.submit({
      admin: { username: admin.username.trim(), name: admin.name.trim(), password: admin.password },
      site: { workspaceName: site.workspaceName, workspaceSubtitle: site.workspaceSubtitle }
    })
    app.needsSetup = false
    ElMessage.success('初始化完成，请登录')
    router.replace({ name: 'Login' })
  } catch {
    /* axios 已提示 */
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.setup-page { display: flex; min-height: 100vh; background: var(--yh-card); }
.setup-side {
  width: 44%; max-width: 560px; padding: 56px; color: var(--yh-on-primary); display: flex; flex-direction: column;
  background: var(--yh-hero);
}
.side-inner { margin-top: 10vh; }
.side-logo {
  width: 52px; height: 52px; border-radius: 14px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.3);
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 26px; color: var(--yh-on-primary);
}
h1 { font-size: 30px; margin: 28px 0 12px; font-weight: 600; letter-spacing: 1px; }
.side-desc { font-size: 16px; line-height: 1.8; opacity: .9; margin: 0; }
.side-points { list-style: none; padding: 0; margin: 36px 0 0; display: flex; flex-direction: column; gap: 14px; font-size: 14px; opacity: .92; }
.side-points span { display: inline-flex; width: 22px; height: 22px; border-radius: 50%; background: rgba(255,255,255,.18); align-items: center; justify-content: center; margin-right: 10px; font-size: 12px; }

.setup-main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--yh-bg); }
.setup-card { width: 100%; max-width: 460px; background: var(--yh-card); border-radius: 16px; padding: 32px; box-shadow: var(--yh-shadow-lg); }
.steps { margin-bottom: 28px; }
.form { margin-top: 4px; }
.finish { padding: 8px 0 4px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }

@media (max-width: 767px) {
  .setup-side { display: none; }
  .setup-main { align-items: flex-start; padding-top: 8vh; }
  .setup-card { box-shadow: none; background: transparent; padding: 12px 8px; }
}
</style>
