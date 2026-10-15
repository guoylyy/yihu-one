import { get, post, put, del } from './index'

export const adminApi = {
  spaces: () => get('/admin/spaces'),
  createSpace: data => post('/admin/spaces', data),
  updateSpace: (id, data) => put(`/admin/spaces/${id}`, data),
  removeSpace: id => del(`/admin/spaces/${id}`),
  themeCatalog: () => get('/admin/theme-catalog'),
  apps: () => get('/admin/apps'),
  createApp: data => post('/admin/apps', data),
  updateApp: (id, data) => put(`/admin/apps/${id}`, data),
  resetSecret: id => post(`/admin/apps/${id}/reset-secret`),
  removeApp: id => del(`/admin/apps/${id}`),
  overview: () => get('/admin/overview'),

  llmConfigs: () => get('/admin/llm-configs'),
  createLlm: data => post('/admin/llm-configs', data),
  updateLlm: (id, data) => put(`/admin/llm-configs/${id}`, data),
  removeLlm: id => del(`/admin/llm-configs/${id}`),
  testLlm: id => post(`/admin/llm-configs/${id}/test`, null, { timeout: 90000 }),

  audit: params => get('/admin/audit', params)
}

// 各应用近 N 天使用概览
export const usageApi = {
  overview: days => get('/admin/usage', { days })
}

// 系统设置（按分组，schema 驱动）；page: settings 系统设置 / login 登录方式 / ai AI 助手
export const settingsApi = {
  list: page => get('/admin/settings', { page }),
  save: (group, data) => put(`/admin/settings/${group}`, data),
  notifyTest: () => post('/admin/notify/test', null, { timeout: 30000 })
}

// 平台运维：控制台排队，宿主机上的 yh agent 领取执行
export const platformApi = {
  status: () => get('/admin/platform'),
  ops: params => get('/admin/platform/ops', params),
  op: id => get(`/admin/platform/ops/${id}`, null, { silent: true }),
  request: (kind, appCode, params) => post('/admin/platform/ops', { kind, appCode, params }),
  deploys: params => get('/admin/platform/deploys', params),
  // 平台更新包（不能联网的机器）：请求体就是文件本身
  packages: () => get('/admin/platform/packages'),
  uploadPackage: (file, sig) => post('/admin/platform/packages', file, {
    params: { filename: file.name, sig }, headers: { 'Content-Type': 'application/octet-stream' }, timeout: 120000
  }),
  removePackage: id => del(`/admin/platform/packages/${id}`)
}

// 开通向导：各步骤的状态按真实配置算；配置本身还是走各自的接口（settingsApi、llm-configs、org）
export const onboardingApi = {
  status: (silent = false) => get('/admin/onboarding', null, { silent }),
  skip: (step, skipped = true) => post('/admin/onboarding/skip', { step, skipped }),
  complete: () => post('/admin/onboarding/complete'),
  testLogin: provider => post('/admin/onboarding/test-login', { provider }, { timeout: 30000 }),
  messageMe: () => post('/admin/onboarding/message-me', null, { timeout: 30000 }),
  officialApps: () => get('/admin/onboarding/official-apps'),
  installOfficial: code => post(`/admin/onboarding/official-apps/${code}/install`),
  importPeople: data => post('/admin/onboarding/import-people', data, { timeout: 180000 })
}
