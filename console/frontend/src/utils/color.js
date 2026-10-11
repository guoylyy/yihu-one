// 颜色工具：#RRGGBB 混合 / 调浅 / 转色相

function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 37, g: 99, b: 235 } // 兜底默认蓝
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('')
}

/** 混合两个 #RRGGBB 颜色，weight 是 hex2 的占比 0~1 */
export function mix(hex1, hex2, weight) {
  const a = hexToRgb(hex1)
  const b = hexToRgb(hex2)
  const w = Math.max(0, Math.min(1, weight))
  return toHex(a.r + (b.r - a.r) * w, a.g + (b.g - a.g) * w, a.b + (b.b - a.b) * w)
}

/** 往白色方向调浅，weight 0~1 */
export function tint(hex, weight) {
  return mix(hex, '#ffffff', weight)
}

/** '37, 99, 235' 这种写法，给 rgba(var(--x), .3) 用 */
export function rgbTriplet(hex) {
  const { r, g, b } = hexToRgb(hex)
  return `${r}, ${g}, ${b}`
}

function toHsl(hex) {
  const { r, g, b } = hexToRgb(hex)
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l } // 灰色没有色相
  const h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return { h: ((h * 60) + 360) % 360, s: d / (1 - Math.abs(2 * l - 1)), l }
}

/** 色相 0~360 */
export function hueOf(hex) {
  return toHsl(hex).h
}

/** 色相转 deg 度，饱和度和明度不变 */
export function rotateHue(hex, deg) {
  const { h: h0, s, l } = toHsl(hex)
  const h = (((h0 + deg) % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255)
}
