<template>
  <!-- VI 编辑器：选预设 → 按公司 VI 改几项 → 右边实时预览。v-model = { preset, tokens: 只含改过的项 }（后端 services/theme.js） -->
  <div class="te">
    <div class="te-left">
      <div class="presets">
        <button
          v-for="p in catalog.presets"
          :key="p.key"
          type="button"
          class="preset"
          :class="{ on: model.preset === p.key }"
          @click="pickPreset(p.key)"
        >
          <span class="swatches">
            <i :style="{ background: p.tokens.primary }" />
            <i :style="{ background: p.tokens.highlight }" />
            <i :style="{ background: p.tokens.bg }" />
            <i :style="{ background: p.tokens.text2 }" />
          </span>
          <span class="p-name">{{ p.label }}</span>
          <span class="p-desc">{{ p.description }}</span>
        </button>
      </div>

      <div class="te-head">
        <span>按公司 VI 调整</span>
        <span v-if="changedCount" class="changed">改了 {{ changedCount }} 项</span>
        <div class="yh-grow"></div>
        <el-button v-if="changedCount" link type="primary" size="small" @click="resetAll">全部恢复预设</el-button>
      </div>
      <div class="tokens">
        <div v-for="t in catalog.tokens" :key="t.key" class="tk" :class="{ changed: t.key in model.tokens }" :title="t.help || ''">
          <div class="tk-label">
            {{ t.label }}
            <el-button v-if="t.key in model.tokens" link size="small" class="tk-reset" @click="resetToken(t.key)">恢复</el-button>
          </div>
          <div v-if="t.type === 'color'" class="tk-color">
            <el-color-picker :model-value="eff[t.key]" size="small" @update:model-value="v => setToken(t.key, v)" />
            <el-input :model-value="eff[t.key]" size="small" class="hex" @change="v => setToken(t.key, v)" />
          </div>
          <el-input-number
            v-else-if="t.type === 'number'"
            :model-value="eff[t.key]"
            :min="t.min"
            :max="t.max"
            size="small"
            controls-position="right"
            style="width: 110px"
            @update:model-value="v => setToken(t.key, v)"
          />
          <el-select v-else-if="t.type === 'select'" :model-value="eff[t.key]" size="small" @update:model-value="v => setToken(t.key, v)">
            <el-option v-for="o in t.options" :key="o[0]" :label="o[1]" :value="o[0]" />
          </el-select>
          <el-switch v-else-if="t.type === 'bool'" :model-value="eff[t.key]" @update:model-value="v => setToken(t.key, v)" />
        </div>
      </div>
    </div>

    <!-- 预览：把这套令牌只写在预览框上，不影响页面其他地方 -->
    <div class="te-preview" :style="previewVars">
      <div class="pv-side">
        <div class="pv-brand">
          <img v-if="previewLogo" :src="previewLogo" alt="" />
          <span v-else class="pv-mark">{{ (name || '虎').slice(0, 1) }}</span>
          <b>{{ name || '以虎 One' }}</b>
        </div>
        <div class="pv-nav on"><i />首页</div>
        <div class="pv-nav"><i />应用</div>
        <div class="pv-nav"><i />资料</div>
      </div>
      <div class="pv-main">
        <div class="pv-title">本月概览</div>
        <div class="pv-card">
          <div class="pv-k">调用量</div>
          <div class="pv-v"><span class="yh-num">1.28</span><em>M</em></div>
          <div class="pv-ok">↑ 12.4% 较昨日</div>
        </div>
        <div class="pv-row">
          <el-button type="primary" size="small">主按钮</el-button>
          <el-button size="small">次按钮</el-button>
          <a class="pv-link">查看全部 →</a>
        </div>
        <div class="pv-row">
          <el-tag size="small" type="success">成功</el-tag>
          <el-tag size="small" type="warning">警告</el-tag>
          <el-tag size="small" type="danger">错误</el-tag>
          <el-switch :model-value="true" size="small" />
        </div>
        <div class="pv-muted">次要文字 · 辅助文字</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { deriveVars } from '@/utils/theme'

const props = defineProps({
  modelValue: { type: Object, default: null },
  /** 后端 theme.catalog()：{ tokens, presets, defaultPreset } */
  catalog: { type: Object, required: true },
  /** 预览里显示的平台名称 / 上传的 LOGO */
  name: { type: String, default: '' },
  logo: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

const model = computed(() => ({ preset: props.modelValue?.preset || props.catalog.defaultPreset, tokens: { ...(props.modelValue?.tokens || {}) } }))
const preset = computed(() => props.catalog.presets.find(p => p.key === model.value.preset) || props.catalog.presets[0])
/** 生效值 = 预设 + 改过的项；预设里强调色和主色一样时，强调色跟着主色走（和后端 theme.effective 一致） */
const eff = computed(() => {
  const base = preset.value.tokens
  const t = { ...base, ...model.value.tokens }
  if (base.highlight === base.primary && !('highlight' in model.value.tokens)) t.highlight = t.primary
  return t
})
const changedCount = computed(() => Object.keys(model.value.tokens).length)
const previewVars = computed(() => deriveVars(eff.value))
const previewLogo = computed(() => props.logo || preset.value.logo || '')

function emitWith(tokens, presetKey = model.value.preset) {
  emit('update:modelValue', { preset: presetKey, tokens })
}
/** 换预设：已经改过的项保留（多半是公司自己的主色、LOGO 配色），想全换就点「全部恢复预设」 */
function pickPreset(key) {
  const base = props.catalog.presets.find(p => p.key === key)?.tokens || {}
  const kept = Object.fromEntries(Object.entries(model.value.tokens).filter(([k, v]) => base[k] !== v))
  emitWith(kept, key)
}
function setToken(key, v) {
  if (v === null || v === undefined || v === '') return resetToken(key)
  let val = v
  const def = props.catalog.tokens.find(t => t.key === key)
  if (def?.type === 'color') {
    val = String(v).trim().toLowerCase()
    if (/^#[0-9a-f]{3}$/.test(val)) val = '#' + val.slice(1).split('').map(c => c + c).join('')
    if (!/^#[0-9a-f]{6}$/.test(val)) return
  }
  const tokens = { ...model.value.tokens }
  if (preset.value.tokens[key] === val) delete tokens[key]
  else tokens[key] = val
  emitWith(tokens)
}
function resetToken(key) {
  const tokens = { ...model.value.tokens }
  delete tokens[key]
  emitWith(tokens)
}
const resetAll = () => emitWith({})
</script>

<style scoped>
.te { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
.presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 16px; }
.preset {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; padding: 12px 14px; cursor: pointer;
  border: 1px solid var(--yh-border); border-radius: var(--yh-radius-sm); background: var(--yh-card); font-family: inherit; color: var(--yh-text);
}
.preset:hover { border-color: var(--yh-border-strong); }
.preset.on { border-color: var(--yh-primary); box-shadow: 0 0 0 1px var(--yh-primary) inset; }
.swatches { display: flex; gap: 4px; margin-bottom: 4px; }
.swatches i { width: 18px; height: 18px; border-radius: 5px; border: 1px solid rgba(0, 0, 0, .08); }
.p-name { font-weight: 600; font-size: 13.5px; }
.p-desc { font-size: 12px; color: var(--yh-text-3); line-height: 1.5; }
.te-head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; margin-bottom: 8px; }
.changed { font-size: 12px; color: var(--yh-warning); font-weight: 400; }
.tokens { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 16px; }
.tk-label { font-size: 12px; color: var(--yh-text-2); margin-bottom: 4px; display: flex; align-items: center; gap: 4px; min-height: 20px; }
.tk.changed .tk-label { color: var(--yh-text); font-weight: 500; }
.tk.changed .tk-label::before { content: '•'; color: var(--yh-warning); }
.tk-reset { font-size: 12px; }
.tk-color { display: flex; align-items: center; gap: 6px; }
.hex { width: 96px; }
.tk .el-select { width: 100%; }

.te-preview {
  display: flex; border: 1px solid var(--yh-border); border-radius: var(--yh-radius); overflow: hidden; min-height: 260px;
  background: var(--yh-bg); color: var(--yh-text); font-family: var(--yh-font); position: sticky; top: 72px;
}
.pv-side { width: 112px; flex-shrink: 0; background: var(--yh-sidebar); border-right: 1px solid var(--yh-border); padding: 12px 8px; display: flex; flex-direction: column; gap: 2px; }
.pv-brand { display: flex; align-items: center; gap: 6px; padding: 0 4px 10px; font-size: 12px; min-width: 0; }
.pv-brand b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700; }
.pv-brand img { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
.pv-mark { width: 20px; height: 20px; border-radius: 6px; background: var(--yh-primary); color: var(--yh-on-primary); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
.pv-nav { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 8px; border-radius: var(--yh-radius-sm); color: var(--yh-text-2); }
.pv-nav i { width: 9px; height: 2.5px; border-radius: 2px; transform: rotate(-18deg); background: var(--yh-border-strong); }
.pv-nav.on { background: var(--yh-nav-active-bg); color: var(--yh-nav-active-color); font-weight: 500; }
.pv-nav.on i { background: var(--yh-nav-tick); }
.pv-main { flex: 1; min-width: 0; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.pv-title { font-weight: 700; font-size: 14px; }
.pv-card { background: var(--yh-card); border: 1px solid var(--yh-border); border-radius: var(--yh-radius); box-shadow: var(--yh-shadow); padding: 10px 12px; }
.pv-k { font-size: 11px; color: var(--yh-text-3); }
.pv-v { font-size: 22px; font-weight: 800; line-height: 1.3; }
.pv-v em { font-style: normal; font-size: 12px; color: var(--yh-highlight); margin-left: 3px; font-family: var(--yh-font-num); }
.pv-ok { font-size: 11px; color: var(--yh-success); }
.pv-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pv-row .el-button + .el-button { margin-left: 0; }
.pv-link { font-size: 12px; color: var(--yh-highlight); cursor: default; }
.pv-muted { font-size: 12px; color: var(--yh-text-2); }
@media (max-width: 1100px) {
  .te { grid-template-columns: 1fr; }
  .te-preview { position: static; }
}
</style>
