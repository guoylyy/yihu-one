<template>
  <div>
    <el-alert type="info" :closable="false" show-icon class="mb">
      <template #title>AI 助手用这里配置的模型。用户对话时可在「允许用户选择」的模型里挑；关闭下方「允许用户选择模型」后所有人都用默认模型。助手能用的工具 = 平台通用工具 + 用户能看到的应用提供的 MCP 工具。</template>
    </el-alert>

    <div class="toolbar">
      <template v-if="status">
        <el-tag v-if="!status.enabled" type="warning" effect="light">AI 助手未启用：{{ status.reason || '未配置模型' }}</el-tag>
        <el-tag v-else type="success" effect="light">
          AI 助手运行中 · 默认 {{ defaultName }} · {{ status.toolCount ?? 0 }} 个工具 · {{ status.allowModelSelect ? '用户可选模型' : '用户不可选模型' }}
        </el-tag>
      </template>
      <div class="yh-grow"></div>
      <el-button type="primary" :icon="Plus" @click="openEdit(null)">新增模型</el-button>
    </div>

    <el-table v-loading="loading" :data="list">
      <el-table-column label="名称" min-width="200">
        <template #default="{ row }">
          <div class="name">{{ row.name }}</div>
          <div v-if="row.description" class="yh-muted small">{{ row.description }}</div>
          <div v-if="tests[row.id]" class="test-res" :class="tests[row.id].ok ? 'ok' : 'bad'">
            <template v-if="tests[row.id].running"><el-icon class="is-loading"><Loading /></el-icon> 测试中…</template>
            <template v-else>
              {{ tests[row.id].ok ? '✓ 连接正常' : '✗ 连接失败' }}
              <span v-if="tests[row.id].ms !== undefined" class="yh-muted"> · {{ tests[row.id].ms }} ms</span>
              <div v-if="tests[row.id].message && tests[row.id].message !== '连接正常'" class="test-msg">{{ tests[row.id].message }}</div>
            </template>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="150">
        <template #default="{ row }">
          <el-tag size="small" :type="row.provider === 'OPENHEX' ? 'warning' : 'info'" effect="plain">{{ PROVIDERS[row.provider] || row.provider }}</el-tag>
          <el-tag v-if="row.kind === 'EMBEDDING'" size="small" type="success" effect="plain" class="mr4">向量</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="模型 / Agent ID" min-width="150">
        <template #default="{ row }">
          <code class="mono">{{ row.model }}</code>
          <div class="yh-muted small mono">{{ row.apiKey || '未设置密钥' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="默认" width="90" align="center">
        <template #default="{ row }">
          <span v-if="row.kind === 'EMBEDDING'" class="yh-muted small">—</span>
          <el-tag v-else-if="row.isDefault" size="small" type="primary">默认</el-tag>
          <el-button v-else link type="primary" size="small" @click="quick(row, { isDefault: true })">设为默认</el-button>
        </template>
      </el-table-column>
      <el-table-column label="允许用户选" width="96" align="center">
        <template #default="{ row }">
          <el-switch v-if="row.kind !== 'EMBEDDING'" :model-value="row.selectable !== false" size="small" @change="v => quick(row, { selectable: v })" />
          <span v-else class="yh-muted small">—</span>
        </template>
      </el-table-column>
      <el-table-column label="限定角色" width="130">
        <template #default="{ row }">
          <span v-if="row.kind === 'EMBEDDING'" class="yh-muted small">—</span>
          <template v-else-if="row.roles && row.roles.length">
            <el-tag v-for="r in row.roles" :key="r" size="small" effect="plain" class="mr4">{{ ROLE_LABEL[r] || r }}</el-tag>
          </template>
          <span v-else class="yh-muted small">所有人</span>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="70" align="center">
        <template #default="{ row }"><el-switch :model-value="row.enabled" size="small" @change="v => quick(row, { enabled: v })" /></template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" :loading="tests[row.id]?.running" @click="test(row)">测试</el-button>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg.visible" :title="dlg.id ? '编辑模型' : '新增模型'" width="640px" top="5vh">
      <el-form ref="formRef" :model="dlg.form" :rules="rules" label-width="120px">
        <el-form-item label="类型" prop="provider">
          <el-radio-group v-model="dlg.form.provider">
            <el-radio-button value="OPENAI_COMPAT">OpenAI 兼容</el-radio-button>
            <el-radio-button value="ANTHROPIC">Anthropic</el-radio-button>
            <el-radio-button value="OPENHEX">OpenHex 智能体</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="用途">
          <el-radio-group v-model="dlg.form.kind" @change="onKindChange">
            <el-radio-button value="CHAT">对话模型</el-radio-button>
            <el-radio-button value="EMBEDDING">向量模型（知识库用）</el-radio-button>
          </el-radio-group>
          <span v-if="dlg.form.kind === 'EMBEDDING'" class="yh-muted small ml8">供「知识库」文档向量化，不出现在助手选择器</span>
        </el-form-item>
        <el-alert v-if="isOpenhex" type="info" :closable="false" class="hint">
          <template #title>OpenHex 智能体通过 MCP 连接器回调平台 /api/mcp，写操作由智能体在对话中向用户确认</template>
        </el-alert>
        <el-form-item v-if="dlg.form.provider === 'OPENAI_COMPAT'" label="厂商" prop="vendor">
          <el-select v-model="dlg.form.vendor" filterable placeholder="选择厂商自动填地址，或选「自定义」手填" style="width: 100%" @change="onVendor">
            <el-option v-for="v in VENDORS" :key="v.id" :label="v.label" :value="v.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称" prop="name"><el-input v-model="dlg.form.name" placeholder="用户在选择器里看到的名字，如 通义千问 Plus" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="dlg.form.description" placeholder="给用户看的一句话，如 速度快，适合日常查询" /></el-form-item>
        <el-form-item :label="isOpenhex ? 'Base URL（可选）' : 'Base URL'" prop="baseUrl">
          <el-input v-model="dlg.form.baseUrl" :placeholder="isOpenhex ? '留空使用 OpenHex 默认地址' : 'https://api.deepseek.com'" class="mono-input" />
        </el-form-item>
        <el-form-item :label="isOpenhex ? 'Agent ID' : '模型'" prop="model">
          <el-select
            v-if="modelOptions.length"
            v-model="dlg.form.model"
            filterable
            allow-create
            default-first-option
            placeholder="选择常用模型，或直接输入模型名 / 接入点"
            class="mono-input"
            style="width: 100%"
          >
            <el-option v-for="m in modelOptions" :key="m" :label="m" :value="m" />
          </el-select>
          <el-input v-else v-model="dlg.form.model" :placeholder="isOpenhex ? 'OpenHex 智能体 ID' : '如 qwen-plus、deepseek-chat'" class="mono-input" />
        </el-form-item>
        <el-form-item :label="isOpenhex ? 'OpenHex API Key' : 'API Key'" :prop="dlg.id ? undefined : 'apiKey'">
          <el-input
            v-model="dlg.form.apiKey"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="dlg.id ? (dlg.hasKey ? '已设置，留空不修改' : '未设置') : 'sk-...'"
          />
        </el-form-item>
        <el-form-item v-if="isOpenhex" label="MCP 连接器 slug">
          <el-input v-model="dlg.form.mcpConnector" placeholder="OpenHex 里配置的、指向平台 /api/mcp 的连接器 slug" class="mono-input" />
        </el-form-item>
        <el-form-item v-if="!isOpenhex && !isEmbedding" label="Max Tokens"><el-input-number v-model="dlg.form.maxTokens" :min="256" :max="200000" :step="1024" /></el-form-item>
        <el-form-item v-if="!isEmbedding" label="允许用户选择">
          <el-switch v-model="dlg.form.selectable" />
          <span class="yh-muted small ml8">关闭后只能作为默认模型使用，用户的选择器里不出现</span>
        </el-form-item>
        <el-form-item v-if="!isEmbedding" label="限定角色">
          <el-checkbox-group v-model="dlg.form.roles">
            <el-checkbox value="ADMIN">管理员</el-checkbox>
            <el-checkbox value="MEMBER">成员</el-checkbox>
          </el-checkbox-group>
          <span class="yh-muted small ml8">都不勾 = 所有人可用</span>
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="dlg.form.sort" :min="0" :max="9999" /><span class="yh-muted small ml8">越小越靠前</span></el-form-item>
        <el-form-item v-if="!isEmbedding" label="设为默认"><el-switch v-model="dlg.form.isDefault" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="dlg.form.enabled" /></el-form-item>
        <el-form-item label="extra（JSON）">
          <JsonInput v-model="dlg.form.extraText" :error="dlg.extraError" placeholder="{ }（选填，高级参数）" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Loading } from '@element-plus/icons-vue'
import JsonInput from '@/components/JsonInput.vue'
import { adminApi } from '@/api/admin'
import { useAssistantStore } from '@/stores/assistant'
import { ROLE_LABEL } from '@/utils/constants'
import { prettyJson, parseJson } from '@/utils/json'
import { VENDORS, vendorByBaseUrl } from '@/utils/llmVendors'

const PROVIDERS = { OPENAI_COMPAT: 'OpenAI 兼容', ANTHROPIC: 'Anthropic', OPENHEX: 'OpenHex' }

const assistant = useAssistantStore()
const list = ref([])
const loading = ref(false)
const status = ref(null)
const tests = reactive({})
const formRef = ref(null)
const dlg = reactive({ visible: false, id: null, saving: false, hasKey: false, extraError: '', form: {} })

const isOpenhex = computed(() => dlg.form.provider === 'OPENHEX')
const isEmbedding = computed(() => dlg.form.kind === 'EMBEDDING')
const defaultName = computed(() => list.value.find(m => m.isDefault)?.name || '未设置')
const vendorOf = () => VENDORS.find(v => v.id === dlg.form.vendor)
const modelOptions = computed(() => {
  if (dlg.form.provider !== 'OPENAI_COMPAT') return []
  const v = vendorOf()
  return (isEmbedding.value ? v?.embModels : v?.models) || []
})

// 换厂商：自动填地址；模型和名称只在「空着或本来就是建议值」时才替换，不覆盖手填内容
function onVendor(id) {
  const v = VENDORS.find(x => x.id === id)
  if (!v) return
  if (v.baseUrl) dlg.form.baseUrl = v.baseUrl
  const models = isEmbedding.value ? (v.embModels || []) : v.models
  const known = m => VENDORS.some(x => x.models?.includes(m) || x.embModels?.includes(m))
  if (models.length && (!dlg.form.model || known(dlg.form.model))) dlg.form.model = models[0]
  if (v.name && (!dlg.form.name || VENDORS.some(x => x.name === dlg.form.name))) dlg.form.name = v.name
}

// 切到向量模型：只支持 OpenAI 兼容通道，并换成该厂商的向量模型建议
function onKindChange(kind) {
  if (kind === 'EMBEDDING' && dlg.form.provider !== 'OPENAI_COMPAT') dlg.form.provider = 'OPENAI_COMPAT'
  if (dlg.form.vendor) onVendor(dlg.form.vendor)
}

const rules = {
  name: [{ required: true, message: '请填写名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择类型', trigger: 'change' }],
  baseUrl: [{ validator: (_, v, cb) => (isOpenhex.value || (v && v.trim()) ? cb() : cb(new Error('请填写 Base URL'))), trigger: 'blur' }],
  model: [{ validator: (_, v, cb) => (v && v.trim() ? cb() : cb(new Error(isOpenhex.value ? '请填写 Agent ID' : '请填写模型'))), trigger: 'blur' }],
  apiKey: [{ required: true, message: '请填写 API Key', trigger: 'blur' }]
}

async function load() {
  loading.value = true
  try {
    list.value = ((await adminApi.llmConfigs()) || []).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id)
  } finally {
    loading.value = false
  }
  status.value = await assistant.loadStatus(true)
}

function openEdit(row) {
  const extra = row?.extra && typeof row.extra === 'object' ? { ...row.extra } : {}
  const mcpConnector = extra.mcpConnector || ''
  delete extra.mcpConnector
  dlg.id = row?.id || null
  dlg.hasKey = !!row?.apiKey
  dlg.extraError = ''
  dlg.form = {
    name: row?.name || '',
    description: row?.description || '',
    kind: row?.kind || 'CHAT',
    provider: row?.provider || 'OPENAI_COMPAT',
    vendor: row ? (row.provider === 'OPENAI_COMPAT' ? vendorByBaseUrl(row.baseUrl) : 'custom') : '',
    baseUrl: row?.baseUrl || '',
    model: row?.model || '',
    apiKey: '',
    maxTokens: row?.maxTokens || 4096,
    selectable: row ? row.selectable !== false : true,
    roles: row?.roles || [],
    sort: row?.sort ?? list.value.length,
    isDefault: row ? !!row.isDefault : !list.value.length,
    enabled: row ? row.enabled !== false : true,
    mcpConnector,
    extraText: Object.keys(extra).length ? prettyJson(extra) : ''
  }
  dlg.visible = true
}

async function save() {
  try { await formRef.value.validate() } catch { return }
  const f = dlg.form
  const ex = parseJson(f.extraText, { label: 'extra', emptyValue: {} })
  if (!ex.ok) { dlg.extraError = ex.error; return }
  dlg.extraError = ''
  const extra = { ...ex.value }
  if (f.provider === 'OPENHEX' && f.mcpConnector.trim()) extra.mcpConnector = f.mcpConnector.trim()
  else delete extra.mcpConnector
  const payload = {
    name: f.name.trim(),
    description: f.description.trim(),
    provider: f.provider,
    kind: f.kind || 'CHAT',
    baseUrl: f.baseUrl.trim(),
    model: f.model.trim(),
    apiKey: f.apiKey, // 编辑时空串 = 不修改
    maxTokens: f.maxTokens,
    selectable: f.selectable,
    roles: f.roles.length ? f.roles : null,
    sort: f.sort,
    isDefault: f.isDefault,
    enabled: f.enabled,
    extra: Object.keys(extra).length ? extra : null
  }
  dlg.saving = true
  try {
    if (dlg.id) await adminApi.updateLlm(dlg.id, payload)
    else await adminApi.createLlm(payload)
    ElMessage.success('已保存')
    dlg.visible = false
    load()
  } finally {
    dlg.saving = false
  }
}

async function quick(row, data) {
  // 只传要改的字段
  await adminApi.updateLlm(row.id, data)
  ElMessage.success('已保存')
  load()
}

async function test(row) {
  tests[row.id] = { running: true }
  try {
    const r = await adminApi.testLlm(row.id)
    tests[row.id] = { ...r }
  } catch (e) {
    tests[row.id] = { ok: false, message: e.message }
  }
}

async function remove(row) {
  const extra = row.isDefault ? '它是当前默认模型，删除后会自动把下一个模型设为默认。' : ''
  try {
    await ElMessageBox.confirm(`删除模型「${row.name}」？${extra}`, '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  await adminApi.removeLlm(row.id)
  ElMessage.success('已删除')
  load()
}

onMounted(load)
</script>

<style scoped>
.mb { margin-bottom: 14px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.toolbar .el-tag { height: auto; min-height: 24px; white-space: normal; line-height: 1.5; padding: 2px 8px; }
.small { font-size: 12px; }
.ml8 { margin-left: 8px; }
.mr4 { margin-right: 4px; }
.name { font-weight: 500; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.mono-input :deep(input) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.test-res { margin-top: 6px; font-size: 12px; padding: 4px 8px; border-radius: 6px; display: inline-block; }
.test-res.ok { background: #f0fdf4; color: #15803d; }
.test-res.bad { background: #fef2f2; color: #b91c1c; }
.test-msg { color: var(--yh-text-2); word-break: break-word; }
.hint { margin: -4px 0 14px; }
</style>
