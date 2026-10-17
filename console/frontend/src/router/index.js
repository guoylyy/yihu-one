import { createRouter, createWebHistory } from 'vue-router'
import { installGuards } from './guards'
import { useUserStore } from '@/stores/user'
import { safeRedirect } from '@/utils/dingtalk'

const MainLayout = () => import('@/layout/MainLayout.vue')

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { public: true, title: '登录' }
  },
  {
    // 退出平台登录再去登录页：应用的「退出 / 换账号」链接到这里（/logout?redirect=/apps/<code>/），
    // 换个账号登录后回到 redirect。地址会被应用和 SDK 用到，不要改
    path: '/logout',
    name: 'Logout',
    meta: { public: true },
    redirect: to => {
      useUserStore().logout()
      const r = safeRedirect(to.query.redirect)
      return { name: 'Login', query: r === '/' ? {} : { redirect: r } }
    }
  },
  {
    // 首次初始化向导：还没有任何用户时由路由守卫跳到这里
    path: '/setup',
    name: 'Setup',
    component: () => import('@/views/setup/SetupView.vue'),
    meta: { public: true, title: '初始化' }
  },
  {
    // 钉钉 / 飞书 / 企业微信登录回调。这个地址要配到各平台的回调 / 重定向 URL 里，不要改
    path: '/auth/:provider(dingtalk|feishu|wecom)/callback',
    name: 'OAuthCallback',
    component: () => import('@/views/login/OAuthCallback.vue'),
    meta: { public: true, title: '登录中' }
  },
  {
    // 开发中心：公开访问、独立布局。地址固定（会被贴进代码注释），不要改
    path: '/dev',
    component: () => import('@/views/devcenter/DevLayout.vue'),
    meta: { public: true, devDoc: true },
    children: [
      { path: '', name: 'DevHome', component: () => import('@/views/devcenter/DevDoc.vue'), meta: { public: true, devDoc: true } },
      { path: ':slug', name: 'DevDoc', component: () => import('@/views/devcenter/DevDoc.vue'), meta: { public: true, devDoc: true } }
    ]
  },
  {
    // 统一认证授权页：需要登录，但不套主布局
    path: '/sso/authorize',
    name: 'SsoAuthorize',
    component: () => import('@/views/sso/SsoAuthorize.vue'),
    meta: { title: '统一认证' }
  },
  {
    path: '/',
    component: MainLayout,
    children: [
      { path: '', name: 'Home', component: () => import('@/views/home/HomeView.vue'), meta: { title: '工作台', nav: 'home' } },
      { path: 'apps', redirect: '/market' },
      { path: 'market', name: 'Market', component: () => import('@/views/market/MarketView.vue'), meta: { title: '应用市场', nav: 'market' } },
      { path: 'assets', name: 'Assets', component: () => import('@/views/assets/AssetsView.vue'), meta: { title: '资料', nav: 'assets' } },
      { path: 'assets/:id(\\d+)', name: 'AssetDetail', component: () => import('@/views/assets/AssetDetail.vue'), meta: { title: '资料详情', nav: 'assets' } },
      { path: 'market/:id(\\d+)', name: 'AppDetail', component: () => import('@/views/market/AppDetail.vue'), meta: { title: '应用详情', nav: 'market' } },
      { path: 'studio', name: 'Studio', component: () => import('@/views/studio/StudioView.vue'), meta: { title: '创作中心', nav: 'studio' } },
      { path: 'studio/:id(\\d+)', name: 'StudioApp', component: () => import('@/views/studio/StudioApp.vue'), meta: { title: '编辑应用', nav: 'studio', fullHeight: true } },
      { path: 'lite/:id(\\d+)', name: 'Lite', component: () => import('@/views/lite/LiteRunner.vue'), meta: { title: '轻应用', nav: 'market', fullHeight: true } },
      { path: 'assistant', name: 'Assistant', component: () => import('@/views/assistant/AssistantView.vue'), meta: { title: 'AI 助手', nav: 'assistant', fullHeight: true, permission: 'assistant' } },
      { path: 'onboarding', name: 'Onboarding', component: () => import('@/views/onboarding/OnboardingView.vue'), meta: { title: '开通向导', nav: 'admin', permission: 'admin' } },
      { path: 'admin', name: 'Admin', component: () => import('@/views/admin/AdminView.vue'), meta: { title: '管理', nav: 'admin', permission: 'admin' } },
      { path: 'me', name: 'Me', component: () => import('@/views/me/MeView.vue'), meta: { title: '个人中心', nav: 'me' } },
      { path: ':pathMatch(.*)*', name: 'NotFound', component: () => import('@/views/NotFound.vue'), meta: { title: '页面不存在' } }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    // 开发中心的锚点由文档页自己滚动（内容渲染后才有目标元素）
    if (to.meta?.devDoc) return to.path === from.path ? false : { top: 0 }
    return { top: 0 }
  }
})

installGuards(router)

export default router
