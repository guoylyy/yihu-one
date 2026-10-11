// 图片工具：把上传的图片压成适合存进应用图标字段的 data URL

/** 与后端 lib/icon.js 的 ICON_DATA_MAX 一致 */
export const ICON_DATA_MAX = 40000

const readDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new Error('读取图片失败'))
  reader.readAsDataURL(file)
})

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('图片无法解析，换一张试试'))
  img.src = src
})

/** 图标最大只显示到几十像素：缩到 128px 以内再存，小的 SVG 原样保留 */
export async function fileToIcon(file) {
  const raw = await readDataUrl(file)
  if (file.type === 'image/svg+xml' && raw.length <= ICON_DATA_MAX) return raw
  const img = await loadImage(raw)
  const w0 = img.naturalWidth || 128
  const h0 = img.naturalHeight || 128
  for (const side of [128, 96, 64]) {
    const k = Math.min(1, side / Math.max(w0, h0))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w0 * k))
    canvas.height = Math.max(1, Math.round(h0 * k))
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    // 不支持 WebP 导出的浏览器会悄悄退回 PNG，所以要核对前缀
    for (const type of ['image/webp', 'image/png']) {
      const url = canvas.toDataURL(type, 0.9)
      if (url.startsWith(`data:${type};base64,`) && url.length <= ICON_DATA_MAX) return url
    }
  }
  throw new Error('图片压缩后仍然太大，换一张简单些的')
}
