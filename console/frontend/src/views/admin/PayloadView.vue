<template>
  <!-- 审核时看一个版本的内容（按应用类型展示） -->
  <div class="pv">
    <template v-if="kind === 'AGENT'">
      <div class="k">提示词</div><pre class="code">{{ payload.prompt || '（空）' }}</pre>
      <div class="k">可用工具（{{ (payload.tools || []).length }}）</div>
      <div class="tags"><el-tag v-for="t in payload.tools || []" :key="t" size="small" effect="plain">{{ t }}</el-tag><span v-if="!(payload.tools || []).length" class="yh-muted">不调用工具</span></div>
      <template v-if="payload.greeting"><div class="k">欢迎语</div><div>{{ payload.greeting }}</div></template>
      <template v-if="payload.starters?.length"><div class="k">开场问题</div><div v-for="s in payload.starters" :key="s">· {{ s }}</div></template>
    </template>
    <template v-else-if="kind === 'LITE'">
      <div class="k">权限</div>
      <div>{{ permissions?.ai ? '调用 AI 模型；' : '' }}{{ permissions?.tools?.length ? `只读工具：${permissions.tools.join('、')}` : '不调用工具' }}</div>
      <div v-if="versionId" class="k"><el-button size="small" type="primary" plain @click="preview">在新窗口试用这个版本</el-button></div>
      <div class="k">页面代码（{{ (payload.html || '').length.toLocaleString() }} 字符）</div>
      <pre class="code tall">{{ payload.html }}</pre>
    </template>
    <template v-else-if="kind === 'EXTERNAL'">
      <div class="k">地址</div><div class="mono">{{ payload.url }}</div>
      <div class="k">统一登录回调</div><div v-for="u in payload.redirectUris || []" :key="u" class="mono">{{ u }}</div><div v-if="!(payload.redirectUris || []).length" class="yh-muted">不接统一登录</div>
      <div class="k">MCP</div><div class="mono">{{ payload.mcpUrl || '—' }}</div>
      <div class="k">申请的用户信息</div><div>{{ scopeText }}</div>
    </template>
    <template v-else-if="kind === 'SKILL'">
      <div class="k">name / description</div>
      <div><span class="mono">{{ payload.name }}</span> — {{ payload.description }}</div>
      <div class="k">文件（{{ (payload.files || []).length }} 个，指纹 {{ payload.digest }}）</div>
      <div class="yh-muted small">上架后全公司的人会把它装进自己的 Agent 里执行。请逐个看一遍，特别是脚本：不能有偷传数据、删文件之类的操作。</div>
      <template v-for="f in payload.files || []" :key="f.path">
        <div class="k mono">{{ f.path }} <span class="yh-muted small">{{ f.size }} B</span></div>
        <pre v-if="textOf(f) !== null" class="code">{{ textOf(f) }}</pre>
        <div v-else class="yh-muted small">二进制文件</div>
      </template>
    </template>
    <template v-else>
      <div class="k">仓库</div><div class="mono">{{ payload.git }}</div>
      <div class="k">分支</div><div class="mono">{{ payload.branch || '按清单 deploy.branch' }}</div>
      <div class="k">申请的用户信息</div><div>{{ scopeText }}</div>
      <div class="yh-muted small" style="margin-top: 8px">通过后平台会拉取这个仓库、构建并运行。请确认仓库可信、清单里的内存和权限合理。</div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { textOf } from '@/utils/skillFiles'

const props = defineProps({
  kind: { type: String, required: true },
  payload: { type: Object, default: () => ({}) },
  permissions: { type: Object, default: null },
  appId: { type: Number, default: null },
  versionId: { type: Number, default: null }
})
const scopeText = computed(() => {
  const s = props.permissions?.scopes || []
  return ['姓名、账号、角色', s.includes('org') && '部门、职位、工号', s.includes('contact') && '手机号、邮箱'].filter(Boolean).join('、')
})
function preview() {
  window.open(`/lite/${props.appId}?version=${props.versionId}`, '_blank', 'noopener')
}
</script>

<style scoped>
.pv { font-size: 13px; min-width: 0; }
.k { font-weight: 500; color: var(--yh-text-2); margin: 12px 0 6px; }
.k:first-child { margin-top: 0; }
.code { margin: 0; background: var(--yh-fill); border: 1px solid var(--yh-border-soft); border-radius: 8px; padding: 10px 12px; white-space: pre-wrap; word-break: break-all; max-height: 260px; overflow: auto; font-size: 12.5px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.code.tall { max-height: 460px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.small { font-size: 12px; }
</style>
