import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useAppStore } from '@/stores/app'

/** 未登录跳 /login?redirect=；按 meta.permission 拦截 admin */
export function installGuards(router) {
  router.beforeEach(async to => {
    const app = useAppStore()

    // 首次初始化：还没有任何用户时，所有页面都去 /setup；初始化完成后 /setup 不可再进
    if (to.name !== 'Setup') {
      if (app.needsSetup === null) await app.checkSetup()
      if (app.needsSetup) return { name: 'Setup' }
    } else {
      if (app.needsSetup === null) await app.checkSetup()
      if (app.needsSetup === false) return { name: 'Login' }
    }

    const user = useUserStore()

    // 开发中心：默认公开；系统设置关闭「开发中心公开访问」后要求登录
    if (to.meta.devDoc) {
      await app.load()
      if (app.features.devCenterPublic === false && !user.isLoggedIn) {
        return { name: 'Login', query: { redirect: to.fullPath } }
      }
      return true
    }

    if (to.meta.public) {
      // 已登录再访问登录页 → 回首页或 redirect
      if (to.name === 'Login' && user.isLoggedIn) {
        try {
          await user.ensureMe()
          const r = typeof to.query.redirect === 'string' && to.query.redirect.startsWith('/') && !to.query.redirect.startsWith('//') ? to.query.redirect : '/'
          return r
        } catch {
          return true
        }
      }
      return true
    }

    if (!user.isLoggedIn) {
      return { name: 'Login', query: { redirect: to.fullPath } }
    }

    try {
      await user.ensureMe()
    } catch {
      if (!user.isLoggedIn) return { name: 'Login', query: { redirect: to.fullPath } }
      // 网络问题：放行，页面自己报错
      return true
    }

    const perm = to.matched.map(r => r.meta?.permission).find(Boolean)
    if (perm && !user.permissions[perm]) {
      ElMessage.warning('没有访问该页面的权限')
      return hasCurrentRoute(router) ? false : { name: 'Home' }
    }
    return true
  })

  // 系统设置里改了工作台名称：配置加载 / 刷新后重设标题（pinia 在首次导航时才可用，懒订阅）
  let subscribed = false
  router.afterEach(to => {
    if (!subscribed) {
      subscribed = true
      const app = useAppStore()
      app.$subscribe(() => applyTitle(router.currentRoute.value))
      app.load()
    }
    applyTitle(to)
  })
}

function hasCurrentRoute(router) {
  // 首次进入（没有上一个页面）时不能 return false，否则白屏
  return !!router.currentRoute.value.matched.length
}

/** 浏览器标题：「页面 · 工作台名称」；开发中心页面自己设置 */
export function applyTitle(to) {
  if (!to || to.meta?.devDoc) return
  const name = useAppStore().workspaceName
  document.title = to.meta?.title ? `${to.meta.title} · ${name}` : name
}
