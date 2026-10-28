import { defineStore } from 'pinia'
import { authApi } from '@/api/auth'
import { setupApi } from '@/api/setup'
import { applyTheme } from '@/utils/theme'
import { readBrandCache, writeBrandCache } from '@/utils/brandCache'

// 公开的平台配置（/api/auth/config）：名称、组织、功能开关。后台「系统设置」改了立即生效
/** 浏览器标签页图标跟随 LOGO；没设置 LOGO 时用主题自带的图标，再没有用默认图标 */
function applyFavicon(logo) {
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  if (!link.dataset.default) link.dataset.default = link.getAttribute('href') || '/favicon.svg'
  link.href = logo || link.dataset.default
  link.removeAttribute('type')
}

export const useAppStore = defineStore('app', {
  state: () => ({
    config: null,
    // 上次的品牌名：配置回来之前先用它，避免首屏闪「以虎 One」
    cachedBrand: readBrandCache(),
    // 所在空间自己的 VI（/api/me 的 brand）；null = 跟随平台
    brand: null,
    loading: null,
    needsSetup: null // null=未知 / true=待初始化 / false=已初始化
  }),
  getters: {
    workspaceName: s => s.brand?.name || s.config?.workspaceName || s.cachedBrand?.name || '以虎 One',
    // 英文名：设置过（哪怕是空串）就用设置的值，空串表示不显示
    workspaceSubtitle: s => {
      if (s.config && 'workspaceSubtitle' in s.config) return s.config.workspaceSubtitle || ''
      if (s.cachedBrand) return s.cachedBrand.subtitle || ''
      return 'YIHU ONE'
    },
    /** 生效的主题：空间的 > 平台的（后端 services/theme.js 的 resolve） */
    theme: s => s.brand?.theme || s.config?.theme || null,
    /** 上传的 LOGO（空间的 > 平台的）；都没有用主题预设自带的 */
    customLogo: s => s.brand?.logo || s.config?.logo || '',
    logo() { return this.customLogo || this.theme?.logo || '' },
    /** 深色底上用：上传的 LOGO 没法自动反白，原样用 */
    logoReversed() { return this.customLogo || this.theme?.logoReversed || this.theme?.logo || '' },
    companyName: s => s.config?.companyName || '',
    features: s => ({ devCenterPublic: true, assistant: true, assistantName: 'AI 助手', ...(s.config?.features || {}) }),
    logoChar() {
      return (this.workspaceName || '虎').trim().slice(0, 1)
    }
  },
  actions: {
    /** 拉一次；force 用于设置保存后刷新 */
    load(force = false) {
      if (this.config && !force) return Promise.resolve(this.config)
      if (this.loading && !force) return this.loading
      this.loading = authApi
        .config()
        .then(c => {
          this.config = c || {}
          writeBrandCache(this.workspaceName, this.workspaceSubtitle)
          this.applyLook()
          return this.config
        })
        .catch(() => {
          this.config = this.config || {}
          return this.config
        })
        .finally(() => {
          this.loading = null
        })
      return this.loading
    },
    /** 登录后 / 退出时由 user store 调：换成所在空间的 VI，null 回到平台的 */
    setBrand(brand) {
      this.brand = brand || null
      this.applyLook()
    },
    applyLook() {
      applyTheme(this.theme)
      applyFavicon(this.customLogo || this.theme?.favicon || '')
    },
    /** 是否需要初始化（还没有任何用户）。结果缓存；后端连不上时按 false 处理，别挡住页面 */
    async checkSetup(force = false) {
      if (this.needsSetup !== null && !force) return this.needsSetup
      try {
        this.needsSetup = (await setupApi.status()).needsSetup
      } catch {
        this.needsSetup = false
      }
      return this.needsSetup
    }
  }
})
