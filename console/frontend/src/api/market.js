import { get, post, put, del } from './index'

// 应用市场（所有人）
export const marketApi = {
  list: params => get('/market/apps', params),
  detail: id => get(`/market/apps/${id}`),
  rate: (id, data) => post(`/market/apps/${id}/rate`, data),
  report: (id, reason) => post(`/market/apps/${id}/report`, { reason }),
  skillFiles: id => get(`/market/skills/${id}/files`)
}

// 创作中心（发布者）
export const studioApi = {
  list: () => get('/studio/apps'),
  create: data => post('/studio/apps', data),
  get: id => get(`/studio/apps/${id}`),
  updateListing: (id, data) => put(`/studio/apps/${id}`, data),
  remove: id => del(`/studio/apps/${id}`),
  saveDraft: (id, data) => put(`/studio/apps/${id}/draft`, data, { silent: true }),
  submit: (id, data) => post(`/studio/apps/${id}/submit`, data),
  withdraw: id => post(`/studio/apps/${id}/withdraw`),
  restore: (id, versionId) => post(`/studio/apps/${id}/versions/${versionId}/restore`),
  secret: id => post(`/studio/apps/${id}/secret`),
  tools: () => get('/studio/tools')
}

// 管理员：审核与市场
export const reviewApi = {
  list: status => get('/admin/review', { status }),
  detail: vid => get(`/admin/review/${vid}`),
  approve: (vid, note) => post(`/admin/review/${vid}/approve`, { note }),
  reject: (vid, note) => post(`/admin/review/${vid}/reject`, { note }),
  delist: (appId, reason) => post(`/admin/apps/${appId}/delist`, { reason }),
  reports: status => get('/admin/reports', { status }),
  resolveReport: (id, action, note) => post(`/admin/reports/${id}/resolve`, { action, note }),
  apps: params => get('/admin/market/apps', params)
}

// 轻应用运行时（沙箱页面通过 LiteFrame 转发到这里）；version 为预览的草稿版本
const vq = version => (version ? { version } : undefined)
export const liteApi = {
  bootstrap: (id, version) => get(`/lite/${id}`, vq(version)),
  grant: id => post(`/lite/${id}/grant`),
  collections: id => get(`/lite/${id}/collections`),
  list: (id, c, q, version) => get(`/lite/${id}/db/${encodeURIComponent(c)}`, { ...q, where: q?.where ? JSON.stringify(q.where) : undefined, ...vq(version) }, { silent: true }),
  get: (id, c, rid, version) => get(`/lite/${id}/db/${encodeURIComponent(c)}/${rid}`, vq(version), { silent: true }),
  add: (id, c, body, version) => post(`/lite/${id}/db/${encodeURIComponent(c)}${version ? `?version=${version}` : ''}`, body, { silent: true }),
  update: (id, c, rid, body, version) => put(`/lite/${id}/db/${encodeURIComponent(c)}/${rid}${version ? `?version=${version}` : ''}`, body, { silent: true }),
  remove: (id, c, rid, version) => del(`/lite/${id}/db/${encodeURIComponent(c)}/${rid}${version ? `?version=${version}` : ''}`, { silent: true }),
  ask: (id, body, version) => post(`/lite/${id}/ai${version ? `?version=${version}` : ''}`, body, { silent: true, timeout: 120000 }),
  tool: (id, name, args, version) => post(`/lite/${id}/tools/${encodeURIComponent(name)}${version ? `?version=${version}` : ''}`, { args }, { silent: true, timeout: 90000 })
}
