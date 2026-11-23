// 浏览器标签页标题：品牌在前，页面在后；首页只显示品牌名。
// 纯函数 + 一处绑定，不依赖 @/ 别名，node --test 可以直接测（test/title.test.mjs）

export const DEFAULT_BRAND = '以虎 One'

/** 品牌名，全平台只在这里算一次：空间 VI 品牌名 → 平台名称 → 上次缓存的品牌名 → 以虎 One（老板定的口径，不要调顺序） */
export function brandName(s) {
  return s?.brand?.name || s?.config?.workspaceName || s?.cachedBrand?.name || DEFAULT_BRAND
}

/**
 * 某个路由该显示的标题；返回 null 表示这个页面自己管（开发中心）。
 * override：页面运行时给的名字（如轻应用的应用名），只对同一个 fullPath 生效，离开页面自然失效
 */
export function titleFor(to, brand, override) {
  if (!to || to.meta?.devDoc) return null
  const name = brand || DEFAULT_BRAND
  if (to.name === 'Home') return name
  const page = (override && override.path === to.fullPath && override.title) || to.meta?.title
  return page ? `${page} · ${name}` : name
}

/** 按 store 的当前状态写 document.title */
export function applyTitle(to, store) {
  const t = titleFor(to, store.workspaceName, store.titleOverride)
  if (t != null && typeof document !== 'undefined') document.title = t
  return t
}

/** store 有任何变动（配置加载、setBrand 换空间、页面给了应用名）都按当前路由重设一次 */
export function bindTitle(store, currentRoute) {
  return store.$subscribe(() => applyTitle(currentRoute(), store))
}
