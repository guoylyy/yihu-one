// JSON 文本框的格式化与校验
export function prettyJson(v) {
  if (v === undefined || v === null || v === '') return ''
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

/**
 * 解析 JSON 文本；空文本返回 emptyValue
 * @returns {{ ok: boolean, value?: any, error?: string }}
 */
export function parseJson(text, { label = 'JSON', emptyValue = undefined, expectObject = true } = {}) {
  const t = (text || '').trim()
  if (!t) return { ok: true, value: emptyValue }
  try {
    const v = JSON.parse(t)
    if (expectObject && (v === null || typeof v !== 'object' || Array.isArray(v))) {
      return { ok: false, error: `${label} 必须是 JSON 对象（{ ... }）` }
    }
    return { ok: true, value: v }
  } catch (e) {
    return { ok: false, error: `${label} 不是合法的 JSON：${e.message}` }
  }
}
