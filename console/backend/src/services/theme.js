// 主题（VI）：控制台的颜色、字体、圆角、阴影、LOGO 是一整套「视觉识别」，不只是一个主色。
// 每家公司 VI 不一样：管理员在「系统设置 → 外观与主题」选一套预设、再按自己公司的 VI 改其中几项；
// 多空间时每个空间还可以有自己的 VI（Space.brand），空间里的人登录后看到的是自己公司的样子。
// 存的是 { preset, tokens: 只存改过的项 }，生效值 = 预设 + 改过的项（resolve）。前端 utils/theme.js 按生效值换肤。

const HEX = /^#[0-9a-fA-F]{6}$/

/** 可调的设计令牌。color 都是 #RRGGBB；其余见 type */
export const TOKENS = {
  primary: { label: '主色', type: 'color', help: '主按钮、开关、选中项的底色' },
  onPrimary: { label: '主色上的文字', type: 'color', help: '主按钮、选中导航上的文字颜色' },
  highlight: { label: '强调色', type: 'color', help: '链接、当前状态、关键数据。以虎 VI 里是虎橙，只做点缀' },
  accent: { label: '辅助色', type: 'color', help: '渐变的另一头、AI 标识等装饰' },
  bg: { label: '页面底色', type: 'color' },
  surface: { label: '卡片底色', type: 'color' },
  sidebar: { label: '侧边栏底色', type: 'color' },
  text: { label: '正文', type: 'color' },
  text2: { label: '次要文字', type: 'color' },
  text3: { label: '辅助文字', type: 'color' },
  border: { label: '边框', type: 'color' },
  success: { label: '成功', type: 'color' },
  warning: { label: '警告', type: 'color' },
  danger: { label: '错误', type: 'color' },
  radius: { label: '卡片圆角（px）', type: 'number', min: 0, max: 24 },
  shadow: { label: '阴影', type: 'select', options: [['none', '无（扁平）'], ['soft', '轻'], ['raised', '明显']] },
  gradient: { label: '使用渐变', type: 'bool', help: '关掉后原来用渐变的地方（AI 按钮、横幅）用纯主色' },
  font: { label: '字体', type: 'select', options: [['brand', 'Manrope + 思源黑体'], ['system', '系统默认字体']] },
  navStyle: { label: '导航选中样式', type: 'select', options: [['solid', '实心（主色底）'], ['soft', '浅色（主色浅底）']] }
}

export const DEFAULT_PRESET = 'yihu'

/** 预设。logo / logoReversed（深色底上用的反白版）/ favicon 是没上传 LOGO 时用的默认图（前端 public/ 下） */
export const PRESETS = {
  yihu: {
    label: '以虎科技 VI',
    description: '墨色为主、米白为底、虎橙点缀；扁平、无渐变，Manrope + 思源黑体',
    logo: '/brand/yihu/logo-mark.svg',
    logoReversed: '/brand/yihu/logo-mark-reversed.svg',
    favicon: '/brand/yihu/favicon.svg',
    tokens: {
      primary: '#1c1917', onPrimary: '#faf9f7', highlight: '#d2521e', accent: '#d2521e',
      bg: '#faf9f7', surface: '#ffffff', sidebar: '#faf9f7',
      text: '#1c1917', text2: '#5c574f', text3: '#8f8a82', border: '#eae7e2',
      success: '#2e7d4f', warning: '#b3450f', danger: '#c2362b',
      radius: 12, shadow: 'none', gradient: false, font: 'brand', navStyle: 'solid'
    }
  },
  classic: {
    label: '经典蓝',
    description: '蓝紫渐变、浅灰底、轻阴影（0.1 之前的默认样子）',
    logo: '',
    logoReversed: '',
    favicon: '',
    tokens: {
      primary: '#2563eb', onPrimary: '#ffffff', highlight: '#2563eb', accent: '#7c3aed',
      bg: '#f5f7fa', surface: '#ffffff', sidebar: '#ffffff',
      text: '#111827', text2: '#4b5563', text3: '#9ca3af', border: '#e5e7eb',
      success: '#16a34a', warning: '#ea580c', danger: '#dc2626',
      radius: 12, shadow: 'soft', gradient: true, font: 'system', navStyle: 'soft'
    }
  }
}

function token(key, v) {
  const def = TOKENS[key]
  if (!def || v === undefined || v === null || v === '') return undefined
  switch (def.type) {
    case 'color': {
      const s = String(v).trim()
      if (!HEX.test(s)) throw new TypeError(`「${def.label}」须为 #RRGGBB 格式的颜色`)
      return s.toLowerCase()
    }
    case 'number': {
      const n = Math.round(Number(v))
      if (Number.isNaN(n) || n < def.min || n > def.max) throw new TypeError(`「${def.label}」须在 ${def.min}~${def.max} 之间`)
      return n
    }
    case 'bool': return !!v
    case 'select': {
      if (!def.options.some(o => o[0] === v)) throw new TypeError(`「${def.label}」只能是 ${def.options.map(o => o[0]).join(' / ')}`)
      return v
    }
  }
  return undefined
}

/** 校验并规范化要保存的主题：只留认识的项、和预设一样的项不存。null / 空 = 不设置（用默认） */
export function normalize(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new TypeError('主题须为 { preset, tokens }')
  const preset = PRESETS[v.preset] ? v.preset : DEFAULT_PRESET
  const base = PRESETS[preset].tokens
  const tokens = {}
  for (const [k, raw] of Object.entries(v.tokens || {})) {
    if (!TOKENS[k]) continue
    const t = token(k, raw)
    if (t !== undefined && t !== base[k]) tokens[k] = t
  }
  return { preset, tokens }
}

/** 生效的主题：预设 + 改过的项。legacyPrimary 是 0.1 之前「主题主色」的值：老平台改过主色的，按「经典蓝 + 那个主色」显示 */
export function resolve(v, legacyPrimary) {
  let n = null
  try { n = normalize(v) } catch { n = null }
  if (!n && legacyPrimary && HEX.test(legacyPrimary)) n = { preset: 'classic', tokens: { primary: legacyPrimary.toLowerCase(), highlight: legacyPrimary.toLowerCase() } }
  if (!n) n = { preset: DEFAULT_PRESET, tokens: {} }
  const p = PRESETS[n.preset]
  return { preset: n.preset, label: p.label, logo: p.logo, logoReversed: p.logoReversed, favicon: p.favicon, tokens: effective(p.tokens, n.tokens), custom: Object.keys(n.tokens) }
}

/** 预设 + 改过的项。预设里强调色和主色一样（经典蓝）时，只改了主色的，强调色跟着主色走（前端 ThemeEditor 预览同一规则） */
export function effective(base, changed) {
  const t = { ...base, ...changed }
  if (base.highlight === base.primary && !('highlight' in changed)) t.highlight = t.primary
  return t
}

/** 给后台编辑器：令牌定义 + 预设 */
export function catalog() {
  return {
    tokens: Object.entries(TOKENS).map(([key, d]) => ({ key, ...d })),
    presets: Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label, description: p.description, logo: p.logo, tokens: p.tokens })),
    defaultPreset: DEFAULT_PRESET
  }
}

// ---------- 空间自己的 VI（Space.brand） ----------

const IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/
const IMAGE_MAX = 280_000

/** 校验空间品牌 { name?, logo?, theme? }；全空 = 跟随平台（返回 null） */
export function normalizeBrand(b) {
  if (b === null || b === undefined || b === '') return null
  if (typeof b !== 'object' || Array.isArray(b)) throw new TypeError('品牌须为 { name, logo, theme }')
  const out = {}
  const name = String(b.name || '').trim()
  if (name.length > 60) throw new TypeError('空间平台名称最多 60 字')
  if (name) out.name = name
  const logo = String(b.logo || '').trim()
  if (logo) {
    if (!IMAGE.test(logo) && !/^https?:\/\/\S+$/.test(logo)) throw new TypeError('LOGO 须为 PNG / JPG / GIF / WebP / SVG 图片')
    if (logo.length > IMAGE_MAX) throw new TypeError('LOGO 图片太大，请压缩到 200KB 以内')
    out.logo = logo
  }
  const theme = normalize(b.theme)
  if (theme) out.theme = theme
  return Object.keys(out).length ? out : null
}

/** 空间品牌的生效值（给前端换肤）；没设置返回 null = 跟随平台 */
export function resolveBrand(b) {
  let n = null
  try { n = normalizeBrand(b) } catch { n = null }
  if (!n) return null
  return { name: n.name || '', logo: n.logo || '', theme: n.theme ? resolve(n.theme) : null }
}
