import { isExternalLink } from './format'
import { appApi } from '@/api/apps'

/**
 * 打开应用（工作台里所有「点应用」都走这里）
 * - 外部应用：必须在点击的同步阶段先 window.open，否则会被浏览器拦截弹窗；之后再记 launch
 * - BUILTIN：站内路由，同样记 launch
 * - launch 失败静默忽略，不影响打开
 */
export function openApp(app, router) {
  if (!app || !app.url) return
  // AI 助手、轻应用在控制台里打开；其他应用新窗口
  if (app.url.startsWith('/') && !app.url.startsWith('/apps/')) router.push(app.url)
  else window.open(appOpenUrl(app), '_blank', 'noopener')
  if (app.id) appApi.launch(app.id).catch(() => {})
}

/**
 * SSO 应用带上 sso=1：应用的登录页看到这个参数会直接跳平台的统一登录（免登），
 * 不用停在应用自己的登录页再点一次。平台 SDK 的示例应用都认这个参数。
 */
function appOpenUrl(app) {
  if (app.type !== 'SSO' || !/^https?:\/\//i.test(app.url)) return app.url
  try {
    const u = new URL(app.url)
    u.searchParams.set('sso', '1')
    return u.toString()
  } catch {
    return app.url
  }
}

/** 打开事项 link：/ 开头站内，否则新窗口 */
export function openLink(link, router) {
  if (!link) return
  if (isExternalLink(link)) window.open(link, '_blank', 'noopener')
  else router.push(link)
}
