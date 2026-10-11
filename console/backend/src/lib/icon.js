/**
 * 应用图标与配色的校验。icon 的几种写法:
 * - svg:<名称>   内置图标库(前端 utils/icons.js)
 * - data:image/… 上传的图片(前端已压到 128px 以内)
 * - 图片地址 / emoji / 其它短文本
 */
import { badRequest } from './http.js'

/** 上传图片(data URL)的长度上限; App.icon 是 TEXT 列, 留足余量 */
export const ICON_DATA_MAX = 40000
const ICON_TEXT_MAX = 500
const DATA_URL = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/

export function validIcon(v) {
  const s = v == null ? '' : String(v).trim()
  if (!s) return null
  if (s.startsWith('data:')) {
    if (s.length > ICON_DATA_MAX) throw badRequest('图标图片太大，请换一张小一点的（建议 128×128 以内）')
    if (!DATA_URL.test(s)) throw badRequest('图标图片只支持 PNG / JPG / GIF / WebP / SVG')
    return s
  }
  if (s.length > ICON_TEXT_MAX) throw badRequest(`图标最多 ${ICON_TEXT_MAX} 个字`)
  return s
}

export function validColor(v) {
  const s = v == null ? '' : String(v).trim()
  if (!s) return null
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw badRequest('颜色须为 #RRGGBB 格式，如 #2563eb')
  return s.toLowerCase()
}
