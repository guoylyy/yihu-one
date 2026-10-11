<template>
  <el-drawer :model-value="modelValue" size="720px" :title="title" destroy-on-close @update:model-value="v => emit('update:modelValue', v)" @closed="stop">
    <div v-if="op" class="op">
      <div class="op-head">
        <el-tag :type="OP_STATUS[op.status]?.type">{{ OP_STATUS[op.status]?.label }}</el-tag>
        <span class="yh-muted small">#{{ op.id }} · {{ op.requestedBy?.name || '系统' }} · {{ formatDateTime(op.createdAt) }}</span>
        <span v-if="elapsed" class="yh-muted small">· {{ elapsed }}</span>
        <div class="yh-grow"></div>
        <el-button v-if="op.log" size="small" @click="copy">复制日志</el-button>
      </div>
      <el-alert v-if="op.status === 'PENDING'" type="info" :closable="false" show-icon style="margin-bottom: 12px"
        title="排队中：等宿主机上的 yh agent 领取（通常几秒内）。如果一直不动，检查宿主机上 yh agent 是否在运行。" />
      <pre ref="logRef" class="log">{{ op.log || (op.status === 'RUNNING' ? '执行中，完成后显示完整日志…' : op.status === 'PENDING' ? '' : '（没有输出）') }}</pre>
    </div>
    <div v-else class="yh-empty">加载中…</div>
  </el-drawer>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { platformApi } from '@/api/admin'
import { OP_KIND, OP_STATUS } from '@/utils/constants'
import { formatDateTime, copyText } from '@/utils/format'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  opId: { type: Number, default: null },
  app: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'done'])

const op = ref(null)
const logRef = ref(null)
let timer = null

const title = computed(() => `${props.app?.name || op.value?.appCode || ''} · ${OP_KIND[op.value?.kind] || '操作'}`)
const elapsed = computed(() => {
  const o = op.value
  if (!o?.startedAt) return ''
  const s = Math.round(((o.finishedAt ? new Date(o.finishedAt) : new Date()) - new Date(o.startedAt)) / 1000)
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
})

async function poll() {
  if (!props.opId) return
  try {
    const o = await platformApi.op(props.opId)
    const wasDone = op.value && !['PENDING', 'RUNNING'].includes(op.value.status)
    op.value = o
    const done = !['PENDING', 'RUNNING'].includes(o.status)
    if (done) {
      if (!wasDone) emit('done', o)
      await nextTick()
      if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight
      return
    }
  } catch {
    /* 网络抖动：下一轮再试 */
  }
  timer = setTimeout(poll, 2000)
}

function stop() {
  clearTimeout(timer)
  op.value = null
}

watch(() => [props.modelValue, props.opId], ([open]) => {
  clearTimeout(timer)
  if (open) { op.value = null; poll() }
})

async function copy() {
  if (await copyText(op.value.log)) ElMessage.success('已复制')
}
</script>

<style scoped>
.op { display: flex; flex-direction: column; height: 100%; }
.op-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.small { font-size: 12px; }
.log {
  flex: 1; margin: 0; background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 10px; overflow: auto;
  font-size: 12.5px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all;
  min-height: 300px;
}
</style>
