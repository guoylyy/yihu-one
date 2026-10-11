function pad(n) { return String(n).padStart(2, '0') }

function toDate(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

export function formatDateTime(v) {
  const d = toDate(v)
  if (!d) return '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(v) {
  const d = toDate(v)
  if (!d) return '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 相对时间：刚刚 / 5 分钟前 / 今天 14:20 / 3 天前 / 2026-09-01 */
export function fromNow(v) {
  const d = toDate(v)
  if (!d) return '-'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 0) {
    // 未来时间（截止时间）
    const ahead = -diff
    if (ahead < 3600) return `${Math.ceil(ahead / 60)} 分钟后`
    if (ahead < 86400) return `${Math.round(ahead / 3600)} 小时后`
    if (ahead < 86400 * 7) return `${Math.round(ahead / 86400)} 天后`
    return formatDate(d)
  }
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diff < 86400 * 7) return `${Math.max(1, Math.floor(diff / 86400))} 天前`
  return formatDate(d)
}

export function formatMoney(v, withUnit = true) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  if (isNaN(n)) return String(v)
  const s = n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return withUnit ? `¥${s}` : s
}

/** 大额简写：12.5 万 */
export function formatMoneyShort(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return `¥${(n / 10000).toFixed(n >= 1000000 ? 0 : 1)} 万`
  return formatMoney(n)
}

export function formatHours(h) {
  if (h === null || h === undefined) return '-'
  const n = Number(h)
  if (n < 1) return `${Math.round(n * 60)} 分钟`
  if (n < 48) return `${n.toFixed(n < 10 ? 1 : 0)} 小时`
  return `${(n / 24).toFixed(1)} 天`
}

export function isExternalLink(link) {
  return !!link && !link.startsWith('/')
}

export function isImageIcon(icon) {
  return !!icon && /^(https?:)?\/\/|^\/|^data:image/.test(icon)
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 非 https 环境的兜底
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    document.body.removeChild(ta)
    return ok
  }
}
