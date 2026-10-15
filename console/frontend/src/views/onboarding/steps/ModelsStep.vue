<template>
  <div v-loading="loading" class="ob-form">
    <div v-if="list.length" class="ob-section">
      <div class="ob-section-title">已经配好的模型</div>
      <div v-for="m in list" :key="m.id" class="ob-box model-row">
        <div class="yh-grow">
          <div>
            <b>{{ m.name }}</b>
            <el-tag v-if="m.isDefault" size="small" type="success" class="ml">默认</el-tag>
            <el-tag v-if="m.kind === 'EMBEDDING'" size="small" type="info" class="ml">向量模型</el-tag>
            <el-tag v-if="!m.enabled" size="small" type="warning" class="ml">已停用</el-tag>
          </div>
          <div class="yh-muted small">{{ m.model }} · {{ m.baseUrl || m.provider }}</div>
          <div v-if="tests[m.id]" class="small" :class="tests[m.id].ok ? 'ok' : 'bad'">{{ tests[m.id].ok ? '✓' : '✗' }} {{ tests[m.id].message }}</div>
        </div>
        <el-button size="small" :loading="tests[m.id]?.running" @click="test(m)">测试</el-button>
      </div>
      <div class="f-help">要改名称、设默认、限定谁能用，去「管理 → 模型与 AI」。</div>
    </div>

    <div class="ob-section">
      <div class="ob-section-title">{{ list.length ? '再加一个' : '添加模型' }}</div>
      <el-form label-position="top">
        <el-form-item label="厂商">
          <div class="vendors">
            <div v-for="v in CHOICES" :key="v.id" class="vendor" :class="{ on: form.vendor === v.id }" @click="pick(v.id)">{{ v.label }}</div>
          </div>
        </el-form-item>
        <template v-if="form.vendor">
          <el-form-item label="API Key">
            <el-input v-model="form.apiKey" type="password" show-password autocomplete="new-password" placeholder="粘贴厂商控制台里创建的 API Key" />
            <div class="f-help">
              <template v-if="vendor?.keyUrl">在 <a :href="vendor.keyUrl" target="_blank" rel="noopener">{{ vendor.label }} 控制台</a> 创建。</template>
              Key 加密保存在平台数据库里，只用来调用模型。
            </div>
          </el-form-item>
          <div class="row2">
            <el-form-item label="模型">
              <el-select v-model="form.model" filterable allow-create default-first-option style="width: 100%" placeholder="模型名">
                <el-option v-for="m in vendor?.models || []" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
            <el-form-item label="显示名称">
              <el-input v-model="form.name" placeholder="员工在 AI 助手里看到的名字" />
            </el-form-item>
          </div>
          <el-form-item v-if="form.vendor === 'custom' || form.vendor === 'ollama'" label="接口地址（Base URL）">
            <el-input v-model="form.baseUrl" placeholder="https://…/v1，OpenAI 兼容接口" />
          </el-form-item>
          <el-form-item v-if="vendor?.embModels?.length">
            <el-checkbox v-model="form.withEmbedding">同时添加向量模型 {{ vendor.embModels[0] }}（知识库检索用，同一个 Key）</el-checkbox>
          </el-form-item>
          <el-button type="primary" :loading="adding" @click="add">添加并测试</el-button>
        </template>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '@/api/admin'
import { useAssistantStore } from '@/stores/assistant'
import { VENDORS } from '@/utils/llmVendors'

const emit = defineEmits(['changed'])
const assistant = useAssistantStore()
// Claude 走 Anthropic 协议，单独一项；其余都是 OpenAI 兼容
const CLAUDE = { id: 'claude', label: 'Claude（Anthropic）', provider: 'ANTHROPIC', baseUrl: '', name: 'Claude', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], keyUrl: 'https://console.anthropic.com/settings/keys' }
const CHOICES = [...VENDORS.filter(v => v.id !== 'custom'), CLAUDE, VENDORS.find(v => v.id === 'custom')]

const list = ref([])
const loading = ref(false)
const adding = ref(false)
const tests = reactive({})
const form = reactive({ vendor: '', apiKey: '', model: '', name: '', baseUrl: '', withEmbedding: true })
const vendor = computed(() => CHOICES.find(v => v.id === form.vendor))

function pick(id) {
  const v = CHOICES.find(x => x.id === id)
  form.vendor = id
  form.model = v.models[0] || ''
  form.name = v.name || ''
  form.baseUrl = v.baseUrl || ''
}

async function load() {
  loading.value = true
  try { list.value = (await adminApi.llmConfigs()) || [] } finally { loading.value = false }
}

async function test(m) {
  tests[m.id] = { running: true }
  try {
    const r = await adminApi.testLlm(m.id)
    tests[m.id] = { ok: r.ok, message: r.ok ? `${m.kind === 'EMBEDDING' ? '' : '模型回复：'}${r.message}（${(r.ms / 1000).toFixed(1)} 秒）` : r.message }
  } catch (e) {
    tests[m.id] = { ok: false, message: e.message }
  }
}

async function add() {
  if (!form.apiKey.trim()) return ElMessage.warning('请填写 API Key')
  if (!form.model.trim()) return ElMessage.warning('请填写模型名')
  const provider = vendor.value.provider || 'OPENAI_COMPAT'
  if (provider === 'OPENAI_COMPAT' && !form.baseUrl.trim()) return ElMessage.warning('请填写接口地址')
  adding.value = true
  try {
    const base = { provider, baseUrl: form.baseUrl.trim() || null, apiKey: form.apiKey.trim() }
    const created = [await adminApi.createLlm({ ...base, name: form.name.trim() || form.model, model: form.model.trim() })]
    if (form.withEmbedding && vendor.value.embModels?.length) {
      created.push(await adminApi.createLlm({ ...base, kind: 'EMBEDDING', name: `${form.name.trim() || vendor.value.name} 向量`, model: vendor.value.embModels[0] }))
    }
    form.vendor = ''
    form.apiKey = ''
    await load()
    assistant.loadStatus(true)
    emit('changed')
    await Promise.all(created.map(test))
  } finally {
    adding.value = false
  }
}

defineExpose({})
onMounted(load)
</script>

<style scoped>
@import '../onboarding.css';
.model-row { display: flex; align-items: center; gap: 12px; }
.ml { margin-left: 6px; }
.small { font-size: 12px; }
.ok { color: var(--yh-success); }
.bad { color: var(--yh-danger); }
.vendors { display: flex; flex-wrap: wrap; gap: 8px; }
.vendor {
  padding: 6px 12px; border: 1px solid var(--yh-border); border-radius: var(--yh-radius-sm); cursor: pointer; font-size: 13px; background: var(--yh-card);
}
.vendor:hover { border-color: var(--yh-primary); }
.vendor.on { border-color: var(--yh-primary); background: var(--yh-primary-soft); color: var(--yh-primary); }
</style>
