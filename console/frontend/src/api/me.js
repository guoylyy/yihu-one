import { get, post, put, del } from './index'

export const meApi = {
  apiKeys: () => get('/me/api-keys'),
  createApiKey: name => post('/me/api-keys', { name }),
  revokeApiKey: id => del(`/me/api-keys/${id}`),
  mcpInfo: () => get('/me/mcp-info'),
  changePassword: (oldPassword, newPassword) => put('/me/password', { oldPassword, newPassword }),
  updateProfile: data => put('/me/profile', data),
  workbench: () => get('/workbench'),
  home: () => get('/me/home'),
  saveHome: cards => put('/me/home', { cards }),
  resetHome: () => del('/me/home'),
  homeCardData: id => get(`/me/home/cards/${id}/data`, undefined, { silent: true }),
  assistantApps: () => get('/me/assistant-apps'),
  setAssistantApps: off => put('/me/assistant-apps', { off })
}
