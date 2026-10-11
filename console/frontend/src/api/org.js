import { get, post, put, del } from './index'

export const orgApi = {
  departments: params => get('/org/departments', params),
  createDepartment: data => post('/org/departments', data),
  updateDepartment: (id, data) => put(`/org/departments/${id}`, data),
  removeDepartment: id => del(`/org/departments/${id}`),
  users: params => get('/org/users', params),
  createUser: data => post('/org/users', data),
  updateUser: (id, data) => put(`/org/users/${id}`, data),
  setPassword: (id, password) => put(`/org/users/${id}/password`, { password }),
  removeUser: id => del(`/org/users/${id}`),
  sync: (dryRun, spaceId) => post('/org/sync', { dryRun, spaceId }, { timeout: 180000 }),
  syncFeishu: (dryRun, spaceId) => post('/org/sync/feishu', { dryRun, spaceId }, { timeout: 180000 })
}
