<template>
  <div v-loading="loading" class="ob-form">
    <template v-if="draft.login">
      <div class="ob-box">
        <div class="prov-head">
          <div class="yh-grow">
            <b>账号密码</b>
            <div class="yh-muted small">管理员在「用户与部门」里给人设账号和初始密码。用钉钉 / 飞书 / 企业微信的公司可以关掉</div>
          </div>
          <el-switch v-model="draft.login.password" />
        </div>
      </div>

      <div v-for="p in PROVIDERS" :key="p.key" class="ob-box" :class="{ on: draft.login[p.key] }">
        <div class="prov-head">
          <div class="yh-grow">
            <b>{{ p.label }}</b>
            <el-tag v-if="ready(p.key)" size="small" type="success" class="ml">凭证已填</el-tag>
            <div class="yh-muted small">{{ p.sub }}</div>
          </div>
          <el-switch v-model="draft.login[p.key]" />
        </div>

        <div v-if="draft.login[p.key]" class="prov-body">
          <div class="ob-tip">
            <div class="ob-section-title">① 在 {{ p.label }} 后台建应用</div>
            <ol>
              <li v-for="(t, i) in p.steps" :key="i" v-html="t" />
            </ol>
            <div class="ob-section-title">② 要开的权限</div>
            <ul>
              <li v-for="(t, i) in p.perms" :key="i" v-html="t" />
            </ul>
            <div class="ob-section-title">③ 要填的地址</div>
            <div v-for="u in urls(p.key)" :key="u.label" class="url-row">
              <span class="url-label">{{ u.label }}</span>
              <code class="yh-grow">{{ u.value }}</code>
              <el-button link type="primary" @click="copy(u.value)">复制</el-button>
            </div>
            <div v-if="insecure" class="warn small">访问地址不是 https：{{ p.label }} 一般要求回调地址是 https 的公网地址。内网试用可以先只开账号密码登录</div>
            <div class="f-help">逐项说明和常见报错见开发中心 <a href="/dev/login-setup" target="_blank">登录方式配置</a>。</div>
          </div>

          <el-form label-position="top" class="cred">
            <div class="ob-section-title">④ 填凭证</div>
            <div class="row2">
              <SettingField v-for="k in p.fields" :key="k" v-model="draft[p.key][k]" :field="field(p.key, k)" :help="false" />
            </div>
            <template v-if="p.key === 'wecom'">
              <div class="row2">
                <SettingField v-model="draft.wecom.verifyFileName" :field="field('wecom', 'verifyFileName')" :help="false" placeholder="WW_verify_xxxx.txt" />
                <SettingField v-model="draft.wecom.verifyFileContent" :field="field('wecom', 'verifyFileContent')" :help="false" />
              </div>
              <div class="f-help">配「可信域名」时企业微信让下载的验证文件：填上文件名和内容、保存后，回企业微信点「验证」。</div>
            </template>
            <SettingField v-model="draft[p.key].bootstrapAdmins" :field="field(p.key, 'bootstrapAdmins')" />
            <div class="ob-btns">
              <el-button type="primary" :loading="busy[p.key]" @click="saveAndTest(p.key)">保存并测试连接</el-button>
              <a v-if="tests[p.key]?.ok" class="small" href="/login" target="_blank">打开登录页，用{{ p.label }}登录试一下 ↗</a>
            </div>
            <div v-if="tests[p.key]" class="ob-checks">
              <div v-for="c in tests[p.key].checks" :key="c.name" :class="c.ok ? 'ok' : 'bad'">{{ c.ok ? '✓' : '✗' }} {{ c.name }}<span v-if="c.message">：{{ c.message }}</span></div>
            </div>
          </el-form>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { onboardingApi } from '@/api/admin'
import { useSettings } from '../useSettings'
import SettingField from '../SettingField.vue'

const props = defineProps({ status: { type: Object, required: true } })
const emit = defineEmits(['changed'])
const { draft, loading, load, save: saveGroup, field } = useSettings('login')
const busy = reactive({})
const tests = reactive({})

// 和开发中心「登录方式配置」（console/docs/devcenter/login-setup.md）保持一致
const PROVIDERS = [
  {
    key: 'dingtalk', label: '钉钉', sub: '扫码登录 + 钉钉里免登；能同步通讯录、发工作通知',
    fields: ['clientId', 'clientSecret', 'corpId', 'agentId'],
    steps: [
      '<a href="https://open-dev.dingtalk.com/" target="_blank" rel="noopener">钉钉开发者后台</a> → 应用开发 → 企业内部应用 → 创建应用',
      '「凭证与基础信息」里复制 Client ID、Client Secret、AgentId；开发者后台首页右上角复制 CorpId',
      '应用能力 → 添加「网页应用」；版本管理与发布 → 可见范围选全员 → 发布'
    ],
    perms: [
      '权限管理里申请：<code>Contact.User.Read</code> 通讯录个人信息读权限、<code>qyapi_get_member</code> 成员信息读权限（<b>必需</b>）',
      '同步通讯录：<code>qyapi_get_department_list</code>、<code>qyapi_get_department_member</code>',
      '建议：企业员工手机号信息、邮箱等个人信息（第一次登录按手机号对上已有用户）',
      '推送简报等个人消息：「企业内机器人发送消息」，并在下面填 AgentId',
      '权限范围选「全部员工」'
    ]
  },
  {
    key: 'feishu', label: '飞书', sub: '网页授权登录 + 飞书里免登；能同步通讯录、发消息卡片',
    fields: ['appId', 'appSecret'],
    steps: [
      '<a href="https://open.feishu.cn/app" target="_blank" rel="noopener">飞书开发者后台</a> → 创建企业自建应用',
      '「凭证与基础信息」里复制 App ID（cli_ 开头）、App Secret',
      '应用能力 → 添加「网页应用」和「机器人」（发消息用）；版本管理与发布 → 可用范围选全员 → 申请发布。<b>改了权限要重新发版本</b>'
    ],
    perms: [
      '建议：<code>contact:user.phone:readonly</code>、<code>contact:user.email:readonly</code>（按手机号 / 邮箱对上已有用户）',
      '同步通讯录：<code>contact:contact.base:readonly</code>、<code>contact:department.base:readonly</code>、<code>contact:user.base:readonly</code>',
      '发消息：<code>im:message:send_as_bot</code>',
      '数据权限 → 通讯录权限范围选「全部成员」'
    ]
  },
  {
    key: 'wecom', label: '企业微信', sub: '扫码登录 + 企业微信里免登；能发应用消息（不支持同步通讯录）',
    fields: ['corpId', 'agentId', 'secret'],
    steps: [
      '<a href="https://work.weixin.qq.com/wework_admin/" target="_blank" rel="noopener">企业微信管理后台</a> → 应用管理 → 自建 → 创建应用',
      '「我的企业 → 企业信息」最下方复制企业 ID；应用详情里复制 AgentId、Secret',
      '应用详情 → 可见范围选要登录的人'
    ],
    perms: [
      '企业微信没有逐个勾选的权限，要配的是：<b>企业可信 IP</b>（平台机器的公网出口 IP，不配会报 60020）',
      '<b>网页授权及 JS-SDK → 可信域名</b>（要先过验证文件，见下面）、<b>企业微信授权登录 → 授权回调域</b>：都填下面的域名',
      '新建的应用拿不到手机号，平台按企业微信 userid 认人；建议打开「首次登录自动建号」'
    ]
  }
]

const c = computed(() => props.status.facts.callbacks)
const insecure = computed(() => !/^https:\/\//.test(props.status.facts.publicBaseUrl || ''))
function urls(key) {
  if (key === 'dingtalk') return [{ label: '重定向 URL（回调域名）', value: c.value.dingtalk }, { label: '网页应用首页', value: c.value.home }]
  if (key === 'feishu') return [{ label: '重定向 URL', value: c.value.feishu }, { label: '网页应用主页', value: c.value.home }]
  return [{ label: '可信域名 / 授权回调域', value: c.value.wecomDomain }, { label: '工作台应用主页', value: c.value.home }]
}
const REQUIRED = { dingtalk: ['clientId', 'clientSecret'], feishu: ['appId', 'appSecret'], wecom: ['corpId', 'agentId', 'secret'] }
const ready = key => REQUIRED[key].every(k => field(key, k)?.value)

async function copy(t) {
  try { await navigator.clipboard.writeText(t); ElMessage.success('已复制') } catch { ElMessage.info(t) }
}

const LOGIN_KEYS = ['password', 'dingtalk', 'feishu', 'wecom']
async function saveProvider(key) {
  const p = PROVIDERS.find(x => x.key === key)
  await saveGroup(key, [...p.fields, 'bootstrapAdmins', ...(key === 'wecom' ? ['verifyFileName', 'verifyFileContent'] : [])])
}

async function saveAndTest(key) {
  busy[key] = true
  try {
    await saveProvider(key)
    tests[key] = await onboardingApi.testLogin(key)
    // 测通了才把登录开关一起存上，免得把半配好的登录方式露给员工
    if (tests[key].ok) await saveGroup('login', LOGIN_KEYS)
    // 重新读一遍（「凭证已填」、密码项清空），但没保存的登录开关保持原样，测试结果还在展开的面板里
    const toggles = { ...draft.login }
    await load()
    Object.assign(draft.login, toggles)
    emit('changed')
  } finally {
    busy[key] = false
  }
}

async function save() {
  for (const p of PROVIDERS) if (draft.login[p.key]) await saveProvider(p.key)
  await saveGroup('login', LOGIN_KEYS)
  emit('changed')
}
defineExpose({ save })
onMounted(load)
</script>

<style scoped>
@import '../onboarding.css';
.ob-form { max-width: 820px; }
.ob-box.on { border-color: var(--yh-primary); }
.prov-head { display: flex; align-items: center; gap: 12px; }
.prov-body { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--yh-border); }
.prov-body .ob-section-title { font-size: 14px; margin: 10px 0 4px; }
.cred { margin-top: 8px; }
.url-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.url-label { width: 160px; flex-shrink: 0; color: var(--yh-text-3); font-size: 12px; }
.url-row code { word-break: break-all; }
.ml { margin-left: 6px; }
.small { font-size: 12px; }
.warn { color: var(--yh-warning); margin-top: 6px; }
</style>
