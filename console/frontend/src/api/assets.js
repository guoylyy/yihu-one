import { get, post, put, del } from './index'

export const assetApi = {
  list: params => get('/assets', params),
  detail: id => get(`/assets/${id}`),
  create: data => post('/assets', data),
  update: (id, data) => put(`/assets/${id}`, data),
  remove: id => del(`/assets/${id}`),
  /** 传一个文件的内容，返回 { sha256, size } */
  uploadBlob: (id, file) => post(`/assets/${id}/blobs`, file, { headers: { 'Content-Type': 'application/octet-stream' }, timeout: 300000 }),
  publishVersion: (id, data) => post(`/assets/${id}/versions`, data)
}
