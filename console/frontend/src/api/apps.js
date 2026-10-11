import { get, post, put, del } from './index'

export const appApi = {
  list: () => get('/apps'),
  install: id => post(`/apps/${id}/install`),
  uninstall: id => del(`/apps/${id}/install`),
  order: appIds => put('/apps/mine/order', { appIds }),
  // 记录一次打开（使用数据）。失败不提示、不跳登录，不能影响打开应用
  launch: id => post(`/apps/${id}/launch`, null, { silent: true, skipAuthRedirect: true, timeout: 10000 }),
  // 单个应用的使用数据（管理员或应用负责人）
  usage: (id, days) => get(`/apps/${id}/usage`, { days })
}
