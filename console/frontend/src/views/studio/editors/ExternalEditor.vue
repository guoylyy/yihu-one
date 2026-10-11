<template>
  <div class="form-pane">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 18px">
      <template #title>已经有的系统（部署在别的服务器上）。填好地址就能出现在工作台；接统一登录、提供 AI 工具见 <a href="/dev/sso" target="_blank">开发中心</a>。分享和上架都需要管理员审核。</template>
    </el-alert>
    <el-form label-width="96px">
      <el-form-item label="应用地址"><el-input v-model="payload.url" placeholder="https://… 用户点开时打开的地址" /></el-form-item>
      <el-form-item label="统一登录">
        <el-input v-model="redirectText" type="textarea" :rows="2" placeholder="回调地址，每行一个，如 https://crm.example.com/sso/callback；不接统一登录就留空" />
        <div class="yh-muted small">client_id 是 <code>{{ app.code }}</code>；审核通过后在右上角「…」→「获取统一认证凭证」拿到 Secret</div>
      </el-form-item>
      <el-form-item label="用户信息">
        <el-checkbox-group v-model="permissions.scopes">
          <el-checkbox value="org">部门、职位、工号</el-checkbox>
          <el-checkbox value="contact">手机号、邮箱</el-checkbox>
        </el-checkbox-group>
        <div class="yh-muted small full">统一登录默认只给姓名、账号、角色；要更多信息在这里申请，用户第一次打开时会看到并确认</div>
      </el-form-item>
      <el-form-item label="MCP 地址">
        <el-input v-model="payload.mcpUrl" placeholder="选填：https://…/mcp，填了 AI 助手就能用它的工具" />
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDraft } from './useDraft'

const props = defineProps({ app: { type: Object, required: true } })
const emit = defineEmits(['saving'])
const { payload, permissions } = useDraft(props.app, emit, {
  init: (p, perm) => { p.redirectUris ||= []; if (!Array.isArray(perm.scopes)) perm.scopes = [] }
})
const redirectText = computed({
  get: () => payload.value.redirectUris.join('\n'),
  set: v => { payload.value.redirectUris = v.split('\n').map(s => s.trim()).filter(Boolean) }
})
</script>

<style scoped>
.form-pane { max-width: 860px; padding: 20px 24px 40px; }
.small { font-size: 12px; }
.full { width: 100%; line-height: 1.5; }
</style>
