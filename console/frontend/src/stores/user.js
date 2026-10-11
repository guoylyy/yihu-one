import { defineStore } from 'pinia'
import { authApi } from '@/api/auth'
import { getToken, setToken, clearToken } from '@/utils/token'
import { useAppStore } from './app'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: getToken(),
    me: null
  }),
  getters: {
    isLoggedIn: s => !!s.token,
    permissions: s => ({ admin: false, assistant: true, ...(s.me?.permissions || {}) }),
    primaryDept: s => {
      const depts = s.me?.depts || []
      return depts.find(d => d.isPrimary) || depts[0] || null
    }
  },
  actions: {
    /** 登录接口返回 { token, user } */
    applyLogin({ token, user }) {
      this.token = token
      setToken(token)
      if (user) this.setMe(user)
    },
    /** 记下当前用户，并换成所在空间的 VI */
    setMe(me) {
      this.me = me
      useAppStore().setBrand(me?.brand || null)
    },
    async fetchMe() {
      if (!this.token) return null
      this.setMe(await authApi.me())
      return this.me
    },
    /** 路由守卫里调：有 token 没 me 时拉一次 */
    async ensureMe() {
      if (!this.token) return null
      if (this.me) return this.me
      try {
        return await this.fetchMe()
      } catch (e) {
        if (e.status === 401) this.logout()
        throw e
      }
    },
    logout() {
      this.token = ''
      this.me = null
      clearToken()
      useAppStore().setBrand(null)
    }
  }
})
