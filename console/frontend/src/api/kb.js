import http, { get, post, put, del } from './index'

export const kbApi = {
  list: () => get('/kb'),
  create: data => post('/kb', data),
  update: (id, data) => put(`/kb/${id}`, data),
  remove: id => del(`/kb/${id}`),
  documents: id => get(`/kb/${id}/documents`),
  // 文件按二进制上传; 文件名放 query(后端 express.raw 接 Buffer)
  upload: (kbId, file) => http.post(`/kb/${kbId}/documents?name=${encodeURIComponent(file.name)}`, file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    timeout: 120_000
  }),
  reprocess: docId => post(`/kb/documents/${docId}/reprocess`),
  removeDocument: docId => del(`/kb/documents/${docId}`)
}
