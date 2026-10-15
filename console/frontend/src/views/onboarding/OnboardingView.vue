<template>
  <div class="yh-page onboarding">
    <div class="yh-page-header">
      <div>
        <h2 class="yh-page-title">开通向导</h2>
        <div class="yh-page-sub">一步步把平台配成公司自己的：每一步保存后立即生效，不需要的可以跳过，随时回来接着配</div>
      </div>
      <el-button v-if="status" @click="$router.push('/')">回工作台</el-button>
    </div>

    <div v-loading="!status" class="ob-body">
      <aside class="yh-card ob-nav">
        <div class="ob-progress">
          <span>已完成 {{ doneCount }} / {{ STEPS.length - 1 }}</span>
          <el-progress :percentage="Math.round((doneCount / (STEPS.length - 1)) * 100)" :show-text="false" :stroke-width="6" />
        </div>
        <div
          v-for="(s, i) in STEPS"
          :key="s.key"
          class="ob-nav-item"
          :class="{ active: s.key === current, disabled: s.key === 'account' }"
          @click="go(s.key)"
        >
          <span class="ob-dot" :class="dotClass(s.key)">
            <el-icon v-if="stepOf(s.key)?.done"><Check /></el-icon>
            <template v-else-if="stepOf(s.key)?.skipped">–</template>
            <template v-else>{{ i + 1 }}</template>
          </span>
          <div class="yh-grow">
            <div class="ob-nav-title">{{ s.title }}</div>
            <div class="ob-nav-sub">{{ navSub(s.key) }}</div>
          </div>
        </div>
      </aside>

      <main v-if="status" class="yh-card ob-main">
        <div class="ob-head">
          <div class="ob-step-no">第 {{ index + 1 }} 步 / 共 {{ STEPS.length }} 步</div>
          <h3>{{ step.title }}</h3>
          <p class="ob-desc">{{ step.desc }}</p>
        </div>

        <component :is="step.comp" :key="current" ref="stepRef" :status="status" @changed="refresh" @goto="go" />

        <div class="ob-actions">
          <el-button v-if="index > 1" @click="go(STEPS[index - 1].key)">上一步</el-button>
          <span class="yh-grow" />
          <template v-if="current !== 'finish'">
            <el-button v-if="stepOf(current)?.skippable && !stepOf(current)?.done" @click="skip">
              {{ stepOf(current)?.skipped ? '已跳过，下一步' : '跳过这一步' }}
            </el-button>
            <el-button type="primary" :loading="saving" @click="saveAndNext">{{ hasSave ? '保存并继续' : '下一步' }}</el-button>
          </template>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, markRaw, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check } from '@element-plus/icons-vue'
import { onboardingApi } from '@/api/admin'
import CompanyStep from './steps/CompanyStep.vue'
import ThemeStep from './steps/ThemeStep.vue'
import ModelsStep from './steps/ModelsStep.vue'
import LoginStep from './steps/LoginStep.vue'
import PeopleStep from './steps/PeopleStep.vue'
import NotifyStep from './steps/NotifyStep.vue'
import AppsStep from './steps/AppsStep.vue'
import FinishStep from './steps/FinishStep.vue'

const STEPS = [
  { key: 'account', title: '管理员账号', desc: '初始化时已经建好', comp: null },
  { key: 'company', title: '公司信息', desc: '平台叫什么、公司全称、LOGO、访问地址和时区。登录页、侧边栏、AI 助手、钉钉回调都会用到', comp: markRaw(CompanyStep) },
  { key: 'theme', title: '外观', desc: '选一套视觉预设，再按公司 VI 改主色。右边实时预览，保存后所有人立即看到', comp: markRaw(ThemeStep) },
  { key: 'models', title: '大模型', desc: 'AI 助手、老板助理、每日简报都靠它。选厂商、填 API Key，地址和模型名自动带出', comp: markRaw(ModelsStep) },
  { key: 'login', title: '登录方式', desc: '员工用什么登录。用钉钉 / 飞书 / 企业微信的话，按页面上的清单在它们的后台建应用、开权限、填回调地址', comp: markRaw(LoginStep) },
  { key: 'people', title: '人员', desc: '把公司的人和部门放进来：从钉钉 / 飞书同步，或者用表格导入。部门负责人决定谁能看到老板助理和管理层首页', comp: markRaw(PeopleStep) },
  { key: 'notify', title: '消息通知', desc: '个人消息：每日经营简报、定时任务结果推到手机；群机器人：平台升级、应用发布的通知', comp: markRaw(NotifyStep) },
  { key: 'apps', title: '应用', desc: '装上第一批应用。数据都来自应用：装得越多，老板的简报越丰富', comp: markRaw(AppsStep) },
  { key: 'finish', title: '完成', desc: '看一眼哪些配好了、哪些还没配', comp: markRaw(FinishStep) }
]

const route = useRoute()
const router = useRouter()
const status = ref(null)
const stepRef = ref(null)
const saving = ref(false)
const current = ref(STEPS.some(s => s.key === route.query.step) && route.query.step !== 'account' ? route.query.step : null)

const index = computed(() => STEPS.findIndex(s => s.key === current.value))
const step = computed(() => STEPS[index.value] || STEPS[1])
const stepOf = key => status.value?.steps.find(s => s.key === key)
const doneCount = computed(() => (status.value?.steps || []).filter(s => s.key !== 'finish' && s.done).length)
const hasSave = computed(() => typeof stepRef.value?.save === 'function')

function dotClass(key) {
  const s = stepOf(key)
  return { done: s?.done, skipped: !s?.done && s?.skipped }
}
function navSub(key) {
  const s = stepOf(key)
  if (!s) return ''
  if (key === 'finish') return status.value.completedAt ? '已完成开通' : ''
  return s.done ? '已配好' : s.skipped ? '已跳过' : '未配置'
}

async function refresh() {
  status.value = await onboardingApi.status()
  if (!current.value) current.value = status.value.todo[0] || 'finish'
}
function go(key) {
  if (key === 'account') return
  current.value = key
}
watch(current, k => { if (k && route.query.step !== k) router.replace({ query: { ...route.query, step: k } }) })
watch(() => route.query.step, k => { if (k && k !== current.value && STEPS.some(s => s.key === k)) go(k) })

function next() {
  const n = STEPS[index.value + 1]
  if (n) go(n.key)
}
async function saveAndNext() {
  saving.value = true
  try {
    if (hasSave.value && (await stepRef.value.save()) === false) return
    await refresh()
    next()
  } catch {
    /* 接口已提示错误，留在这一步 */
  } finally {
    saving.value = false
  }
}
async function skip() {
  status.value = await onboardingApi.skip(current.value, true)
  next()
}

onMounted(refresh)
</script>

<style scoped>
.onboarding { max-width: 1280px; }
.ob-body { display: flex; gap: 16px; align-items: flex-start; min-height: 400px; }
.ob-nav { width: 240px; flex-shrink: 0; padding: 14px 10px; position: sticky; top: 16px; }
.ob-progress { padding: 0 8px 12px; font-size: 12px; color: var(--yh-text-3); display: flex; flex-direction: column; gap: 6px; }
.ob-nav-item { display: flex; gap: 10px; align-items: center; padding: 8px; border-radius: var(--yh-radius-sm); cursor: pointer; }
.ob-nav-item:hover { background: var(--yh-fill); }
.ob-nav-item.active { background: var(--yh-primary-soft); }
.ob-nav-item.disabled { cursor: default; }
.ob-nav-item.disabled:hover { background: transparent; }
.ob-dot {
  width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--yh-border); flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: var(--yh-text-3);
}
.ob-dot.done { background: var(--yh-success); border-color: var(--yh-success); color: var(--yh-on-primary); }
.ob-dot.skipped { border-color: var(--yh-warning); color: var(--yh-warning); }
.ob-nav-item.active .ob-dot:not(.done) { border-color: var(--yh-primary); color: var(--yh-primary); }
.ob-nav-title { font-size: 14px; font-weight: 500; }
.ob-nav-sub { font-size: 12px; color: var(--yh-text-3); }
.ob-main { flex: 1; min-width: 0; padding: 24px 28px; }
.ob-step-no { font-size: 12px; color: var(--yh-text-3); }
.ob-head h3 { margin: 4px 0 6px; font-size: 20px; }
.ob-desc { margin: 0 0 20px; color: var(--yh-text-2); font-size: 14px; line-height: 1.7; }
.ob-actions { display: flex; gap: 8px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--yh-border-soft); }

@media (max-width: 900px) {
  .ob-body { flex-direction: column; }
  .ob-nav { width: 100%; position: static; display: flex; overflow-x: auto; gap: 4px; padding: 8px; }
  .ob-progress { display: none; }
  .ob-nav-item { flex-shrink: 0; }
  .ob-nav-sub { display: none; }
  .ob-main { padding: 18px 16px; }
}
</style>
