<template>
  <div v-loading="s.loading.value || l.loading.value" class="ob-form">
    <div class="ob-section">
      <div class="ob-section-title">个人消息</div>
      <div class="ob-tip">
        每日经营简报、定时任务的结果、应用的提醒（如任务指派、审批）推到每个人自己的钉钉 / 飞书 / 企业微信。用上一步配好的登录方式发，收消息的人要用那种方式登录过（或从通讯录同步过）。
        <ul>
          <li v-for="c in channels" :key="c.key">
            <b>{{ c.label }}</b>：<span :class="c.ok ? 'ok' : 'yh-muted'">{{ c.text }}</span>
          </li>
        </ul>
      </div>
      <el-form v-if="status.facts.im.dingtalk && l.draft.dingtalk" label-position="top">
        <div class="row2">
          <SettingField v-model="l.draft.dingtalk.agentId" :field="l.field('dingtalk', 'agentId')" :help="false" placeholder="钉钉应用的 AgentId" />
        </div>
      </el-form>
      <div class="ob-btns">
        <el-button :loading="sending" @click="messageMe">发一条给我</el-button>
        <span v-if="sent" :class="sent.ok ? 'ok' : 'bad'" class="small">{{ sent.ok ? '✓' : '✗' }} {{ sent.message }}</span>
      </div>
    </div>

    <div v-if="s.draft.notify" class="ob-section">
      <div class="ob-section-title">群机器人 <span class="yh-muted small">（可选）</span></div>
      <div class="ob-tip">平台升级 / 回滚、应用自动发布的结果发到运维或 IT 群里。在群设置里添加「自定义机器人」，把 Webhook 地址贴过来，安全设置建议选关键词「发布」。</div>
      <el-form label-position="top">
        <SettingField v-model="s.draft.notify.enabled" :field="s.field('notify', 'enabled')" :help="false" />
        <SettingField v-model="s.draft.notify.feishuWebhook" :field="s.field('notify', 'feishuWebhook')" :help="false" />
        <div class="row2">
          <SettingField v-model="s.draft.notify.dingtalkWebhook" :field="s.field('notify', 'dingtalkWebhook')" :help="false" />
          <SettingField v-model="s.draft.notify.dingtalkSecret" :field="s.field('notify', 'dingtalkSecret')" :help="false" placeholder="SEC 开头，用关键词就留空" />
        </div>
        <SettingField v-model="s.draft.notify.wecomWebhook" :field="s.field('notify', 'wecomWebhook')" :help="false" />
      </el-form>
      <el-button :loading="testing" @click="testGroup">保存并发测试消息</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { onboardingApi, settingsApi } from '@/api/admin'
import { useSettings } from '../useSettings'
import SettingField from '../SettingField.vue'

const props = defineProps({ status: { type: Object, required: true } })
const emit = defineEmits(['changed'])
const s = useSettings('settings')
const l = useSettings('login')
const sending = ref(false)
const sent = ref(null)
const testing = ref(false)

const channels = computed(() => {
  const im = props.status.facts.im
  return [
    { key: 'dingtalk', label: '钉钉', ok: im.dingtalk && !!l.draft.dingtalk?.agentId, text: !im.dingtalk ? '没开钉钉登录' : l.draft.dingtalk?.agentId ? '工作通知可以发' : '还要填 AgentId，并给应用开通「企业内机器人发送消息」' },
    { key: 'feishu', label: '飞书', ok: im.feishu, text: im.feishu ? '可以发消息卡片（应用要开机器人能力和 im:message:send_as_bot 权限）' : '没开飞书登录' },
    { key: 'wecom', label: '企业微信', ok: im.wecom, text: im.wecom ? '可以发应用消息' : '没开企业微信登录' }
  ]
})

async function saveAll() {
  if (props.status.facts.im.dingtalk) await l.save('dingtalk', ['agentId'])
  await s.save('notify', ['enabled', 'feishuWebhook', 'dingtalkWebhook', 'dingtalkSecret', 'wecomWebhook'])
}

async function messageMe() {
  sending.value = true
  try {
    if (props.status.facts.im.dingtalk) await l.save('dingtalk', ['agentId'])
    sent.value = await onboardingApi.messageMe()
    emit('changed')
  } finally {
    sending.value = false
  }
}

async function testGroup() {
  testing.value = true
  try {
    await saveAll()
    const r = await settingsApi.notifyTest()
    const ok = (r?.results || []).filter(x => x.ok).map(x => x.name).join('、')
    const bad = (r?.results || []).filter(x => !x.ok).map(x => `${x.name}：${x.error}`).join('；')
    ElMessage[bad ? 'warning' : 'success'](`测试消息已发到：${ok || '无'}${bad ? `；失败：${bad}` : ''}`)
    await s.load()
    emit('changed')
  } finally {
    testing.value = false
  }
}

async function save() {
  await saveAll()
  emit('changed')
}
defineExpose({ save })
onMounted(() => { s.load(); l.load() })
</script>

<style scoped>
@import '../onboarding.css';
.ok { color: var(--yh-success); }
.bad { color: var(--yh-danger); }
.small { font-size: 12px; }
.ob-btns { margin-top: 8px; }
</style>
