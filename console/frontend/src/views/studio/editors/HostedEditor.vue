<template>
  <div class="form-pane">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 18px">
      <template #title>代码跑在平台上的应用。仓库根目录要有 <code>yh-app.json</code>（code 填 <code>{{ app.code }}</code>）和 <code>Dockerfile</code>，规范见 <a href="/dev/deploy" target="_blank">应用部署规范</a>。每次发布都要管理员审核，审核通过后平台自动安装；之后推 release 分支自动更新。</template>
    </el-alert>
    <el-form label-width="96px">
      <el-form-item label="仓库地址"><el-input v-model="payload.git" placeholder="git@gitee.com:org/repo.git 或 https://…" /></el-form-item>
      <el-form-item label="分支"><el-input v-model="payload.branch" placeholder="默认用清单里的 deploy.branch" style="width: 280px" /></el-form-item>
      <el-form-item label="用户信息">
        <el-checkbox-group v-model="permissions.scopes">
          <el-checkbox value="org">部门、职位、工号</el-checkbox>
          <el-checkbox value="contact">手机号、邮箱</el-checkbox>
        </el-checkbox-group>
        <div class="yh-muted small full">统一登录默认只给姓名、账号、角色；要更多信息在这里申请</div>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { useDraft } from './useDraft'

const props = defineProps({ app: { type: Object, required: true } })
const emit = defineEmits(['saving'])
const { payload, permissions } = useDraft(props.app, emit, {
  init: (p, perm) => { if (!Array.isArray(perm.scopes)) perm.scopes = [] }
})
</script>

<style scoped>
.form-pane { max-width: 860px; padding: 20px 24px 40px; }
.small { font-size: 12px; }
.full { width: 100%; line-height: 1.5; }
</style>
