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
  else window.open(app.url, '_blank', 'noopener')
  if (app.id) appApi.launch(app.id).catch(() => {})
}

/** 打开事项 link：/ 开头站内，否则新窗口 */
export function openLink(link, router) {
  if (!link) return
  if (isExternalLink(link)) window.open(link, '_blank', 'noopener')
  else router.push(link)
}
