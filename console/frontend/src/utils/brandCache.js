// 品牌名缓存：首屏渲染时 /api/auth/config 还没回来，先用上次的名字顶一下，
// 不然浏览器标题和登录页会先生「以虎 One」再变成这家公司的名字（配置里带 LOGO，可能几百 KB，过隧道要等）
const KEY = 'yh.brand.cache'

/** 上次看到的品牌名；没存过 / 解析不了 / 隐私模式 → null */
export function readBrandCache() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && typeof v === 'object' && typeof v.name === 'string' && v.name ? v : null
  } catch {
    return null
  }
}

/** 配置加载成功后记一笔，下次首屏直接用 */
export function writeBrandCache(name, subtitle) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ name: name || '', subtitle: subtitle ?? '' }))
  } catch { /* 存不了就算了，只是少一次优化 */ }
}

/** 挂载前调用：把标签页标题换成上次的品牌名（路由守卫拿到配置后会再改一次） */
export function applyCachedTitle() {
  const b = readBrandCache()
  if (b?.name) document.title = b.name
}
