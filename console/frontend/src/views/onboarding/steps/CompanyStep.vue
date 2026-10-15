<template>
  <el-form v-loading="loading" label-position="top" class="ob-form">
    <template v-if="draft.general">
      <div class="row2">
        <SettingField v-model="draft.general.workspaceName" :field="field('general', 'workspaceName')" />
        <SettingField v-model="draft.general.workspaceSubtitle" :field="field('general', 'workspaceSubtitle')" />
      </div>
      <SettingField v-model="draft.general.companyName" :field="field('general', 'companyName')" help="公司全称，如「示例科技有限公司」。AI 助手回答时会用到，从钉钉同步通讯录时作为根部门名" />
      <el-form-item label="LOGO">
        <div class="logo-row">
          <div class="logo-box">
            <img v-if="draft.general.logo" :src="draft.general.logo" alt="" />
            <span v-else>{{ (draft.general.workspaceName || '虎').slice(0, 1) }}</span>
          </div>
          <el-button @click="pickLogo">上传图片</el-button>
          <el-button v-if="draft.general.logo" link type="danger" @click="draft.general.logo = ''">移除</el-button>
        </div>
        <div class="f-help">正方形 PNG / SVG，不超过 200KB。侧边栏、登录页、浏览器标签页都用它；不传就用「外观」预设自带的</div>
      </el-form-item>
      <SettingField v-model="draft.general.publicBaseUrl" :field="field('general', 'publicBaseUrl')" help="员工浏览器里打开平台的地址，安装时已经写好。钉钉 / 飞书 / 企业微信的回调地址、推送消息里的链接都按它生成，换了域名记得回来改" />
      <el-form-item label="时区">
        <el-select v-model="draft.general.timezone" filterable allow-create default-first-option style="width: 260px">
          <el-option v-for="z in ZONES" :key="z.value" :label="z.label" :value="z.value" />
        </el-select>
        <div class="f-help">每日经营简报等定时任务按这个时区算时间</div>
      </el-form-item>
    </template>
  </el-form>
</template>

<script setup>
import { onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { useSettings } from '../useSettings'
import SettingField from '../SettingField.vue'

const emit = defineEmits(['changed'])
const app = useAppStore()
const { draft, loading, load, save: saveGroup, field } = useSettings('settings')
const ZONES = [
  { value: 'Asia/Shanghai', label: '中国（Asia/Shanghai）' },
  { value: 'Asia/Hong_Kong', label: '香港（Asia/Hong_Kong）' },
  { value: 'Asia/Singapore', label: '新加坡（Asia/Singapore）' },
  { value: 'Asia/Tokyo', label: '日本（Asia/Tokyo）' },
  { value: 'Europe/London', label: '英国（Europe/London）' },
  { value: 'America/New_York', label: '美东（America/New_York）' },
  { value: 'America/Los_Angeles', label: '美西（America/Los_Angeles）' }
]

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
function pickLogo() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = IMAGE_TYPES.join(',')
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return ElMessage.warning('只支持 PNG / JPG / GIF / WebP / SVG 图片')
    if (file.size > 200 * 1024) return ElMessage.warning(`图片 ${(file.size / 1024).toFixed(0)}KB，请压缩到 200KB 以内`)
    const reader = new FileReader()
    reader.onload = () => { draft.general.logo = reader.result }
    reader.readAsDataURL(file)
  }
  input.click()
}

async function save() {
  if (!String(draft.general.workspaceName || '').trim()) { ElMessage.warning('请填写平台名称'); return false }
  await saveGroup('general', ['workspaceName', 'workspaceSubtitle', 'companyName', 'logo', 'publicBaseUrl', 'timezone'])
  await app.load(true)
  emit('changed')
}
defineExpose({ save })
onMounted(load)
</script>

<style scoped>
@import '../onboarding.css';
.logo-row { display: flex; align-items: center; gap: 12px; }
.logo-box {
  width: 52px; height: 52px; border-radius: var(--yh-radius); border: 1px solid var(--yh-border); background: var(--yh-fill);
  display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 600; color: var(--yh-primary); overflow: hidden;
}
.logo-box img { width: 100%; height: 100%; object-fit: contain; }
</style>
