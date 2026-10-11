// 主题（VI）：把后端算好的生效主题（services/theme.js 的 resolve：预设 + 改过的项）展开成一整组 CSS 变量写到 :root，全站即时换肤。
// 写样式时只用这些变量（--yh-*），不要写死颜色；styles/main.css 里的 :root 是以虎 VI 的同一组值，主题接口回来之前先用它。
// 平台的主题来自 /api/auth/config，所在空间设置了自己的 VI 时登录后换成空间的（stores/app.js）。
import { mix, tint, rgbTriplet } from './color'

const CACHE_KEY = 'yh_theme'

const FONTS = {
  brand: "'Manrope Variable', 'Manrope', 'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif"
}
const SHADOWS = {
  none: ['none', '0 8px 24px rgba(28, 25, 23, 0.08)'],
  soft: ['0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)', '0 12px 32px rgba(16, 24, 40, 0.12)'],
  raised: ['0 2px 6px rgba(16, 24, 40, 0.08), 0 4px 12px rgba(16, 24, 40, 0.08)', '0 16px 40px rgba(16, 24, 40, 0.18)']
}

/** 亮度 0~1：太深的主色（如以虎的墨色）悬停时往浅里调，不然看不出变化 */
function luma(hex) {
  const [r, g, b] = rgbTriplet(hex).split(',').map(Number)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** 生效令牌 → CSS 变量（纯函数，styles/main.css 的默认值也是用它对以虎 VI 生成的） */
export function deriveVars(t) {
  const p = t.primary
  const dark = luma(p) < 0.25
  const hover = dark ? mix(p, '#ffffff', 0.18) : mix(p, '#000000', 0.2)
  const deep = dark ? p : mix(p, '#000000', 0.45)
  const light = tint(p, 0.35)
  const accentDeep = dark ? p : mix(t.accent, '#000000', 0.5)
  const accentLight = tint(t.accent, 0.35)
  const glow = mix(p, t.accent, 0.5)
  const r = t.radius
  const [shadow, shadowLg] = SHADOWS[t.shadow] || SHADOWS.none
  const solid = t.navStyle !== 'soft'
  const soft = tint(p, 0.9)
  return {
    '--yh-primary': p,
    '--yh-primary-rgb': rgbTriplet(p),
    '--yh-primary-dark': hover,
    '--yh-primary-deep': deep,
    '--yh-primary-light': light,
    '--yh-primary-soft': soft,
    '--yh-on-primary': t.onPrimary,
    '--yh-highlight': t.highlight,
    '--yh-highlight-rgb': rgbTriplet(t.highlight),
    '--yh-highlight-soft': tint(t.highlight, 0.9),
    '--yh-accent': t.accent,
    '--yh-accent-light': accentLight,
    '--yh-accent-deep': accentDeep,
    '--yh-glow': glow,
    '--yh-glow-rgb': rgbTriplet(glow),
    '--yh-gradient': t.gradient ? 'linear-gradient(135deg, var(--yh-primary) 0%, var(--yh-accent) 100%)' : 'var(--yh-primary)',
    // 大块品牌面：登录页 / 初始化页左侧、首页 AI 横幅
    '--yh-hero': t.gradient
      ? `radial-gradient(circle at 20% 10%, rgba(255,255,255,.12) 0, transparent 40%), linear-gradient(150deg, ${deep} 0%, ${p} 55%, ${glow} 100%)`
      : p,
    '--yh-hero-ai': t.gradient
      ? `radial-gradient(600px 180px at 10% 0%, rgba(${rgbTriplet(light)}, .35), transparent 70%), radial-gradient(500px 200px at 90% 100%, rgba(${rgbTriplet(accentLight)}, .35), transparent 70%), linear-gradient(135deg, ${deep} 0%, ${accentDeep} 100%)`
      : p,
    '--yh-glow-shadow': t.gradient ? `0 10px 28px rgba(${rgbTriplet(glow)}, .35), 0 2px 6px rgba(${rgbTriplet(glow)}, .2)` : '0 4px 14px rgba(28, 25, 23, .18)',
    '--yh-ai': mix(t.accent, '#000000', 0.12),
    '--yh-ai-soft': tint(t.accent, 0.93),
    '--yh-bg': t.bg,
    '--yh-card': t.surface,
    '--yh-card-rgb': rgbTriplet(t.surface),
    '--yh-sidebar': t.sidebar,
    '--yh-hover': mix(t.text, t.bg, 0.955),
    '--yh-fill': mix(t.text, t.surface, 0.975),
    '--yh-fill-2': mix(t.text, t.surface, 0.95),
    '--yh-fill-3': mix(t.text, t.bg, 0.93),
    '--yh-border': t.border,
    '--yh-border-soft': mix(t.border, t.surface, 0.35),
    '--yh-border-strong': mix(t.border, t.text, 0.08),
    '--yh-text': t.text,
    '--yh-text-2': t.text2,
    '--yh-text-3': t.text3,
    '--yh-danger': t.danger,
    '--yh-success': t.success,
    '--yh-warning': t.warning,
    '--yh-radius': `${r}px`,
    '--yh-radius-sm': `${Math.round((r * 2) / 3)}px`,
    '--yh-shadow': shadow,
    '--yh-shadow-lg': shadowLg,
    '--yh-font': FONTS[t.font] || FONTS.system,
    '--yh-font-num': t.font === 'brand' ? "'Manrope Variable', 'Manrope', system-ui, sans-serif" : 'inherit',
    // 导航选中：实心 = 主色底 + 强调色小横条（以虎 VI）；浅色 = 主色浅底
    '--yh-nav-active-bg': solid ? p : soft,
    '--yh-nav-active-color': solid ? t.onPrimary : p,
    '--yh-nav-tick': solid ? t.highlight : 'currentColor',

    '--el-color-primary': p,
    '--el-color-primary-light-3': tint(p, 0.3),
    '--el-color-primary-light-5': tint(p, 0.5),
    '--el-color-primary-light-7': tint(p, 0.7),
    '--el-color-primary-light-8': tint(p, 0.8),
    '--el-color-primary-light-9': tint(p, 0.9),
    '--el-color-primary-dark-2': hover,
    '--el-color-success': t.success,
    '--el-color-success-light-9': tint(t.success, 0.9),
    '--el-color-warning': t.warning,
    '--el-color-warning-light-9': tint(t.warning, 0.9),
    '--el-color-danger': t.danger,
    '--el-color-danger-light-9': tint(t.danger, 0.9),
    '--el-color-error': t.danger,
    '--el-color-error-light-9': tint(t.danger, 0.9),
    '--el-text-color-primary': t.text,
    '--el-text-color-regular': t.text2,
    '--el-text-color-secondary': t.text3,
    '--el-text-color-placeholder': t.text3,
    '--el-border-color': t.border,
    '--el-border-color-light': mix(t.border, t.surface, 0.25),
    '--el-border-color-lighter': mix(t.border, t.surface, 0.45),
    '--el-bg-color': t.surface,
    '--el-bg-color-overlay': t.surface,
    '--el-bg-color-page': t.bg,
    '--el-fill-color-light': mix(t.text, t.surface, 0.965),
    '--el-fill-color-lighter': mix(t.text, t.surface, 0.98),
    '--el-border-radius-base': `${Math.round((r * 2) / 3)}px`,
    '--el-font-family': FONTS[t.font] || FONTS.system
  }
}

let applied = ''

/** theme = 后端的生效主题 { preset, tokens, ... } */
export function applyTheme(theme) {
  const t = theme?.tokens
  if (!t || !t.primary) return
  const key = JSON.stringify(t)
  if (key === applied) return
  applied = key
  const style = document.documentElement.style
  const vars = deriveVars(t)
  for (const k of Object.keys(vars)) style.setProperty(k, vars[k])
  document.documentElement.dataset.theme = theme.preset || 'custom'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.sidebar || t.bg)
  // 记在本地：下次打开页面先按上次的主题渲染，不用等配置接口回来
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ preset: theme.preset, tokens: t }))
    localStorage.removeItem('yh_primary') // 0.1 之前的缓存
  } catch { /* 无痕模式等存不了就算了 */ }
}

/** 挂载前调用：恢复上次的主题，避免先闪一下默认样子 */
export function restoreTheme() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (cached?.tokens) applyTheme(cached)
  } catch { /* 读不了就用 main.css 里的默认 */ }
}
