import { get, post, del } from './index'
import { getToken } from '@/utils/token'

export const assistantApi = {
  status: appId => get('/assistant/status', appId ? { appId } : null, { silent: true }),
  conversations: () => get('/assistant/conversations'),
  messages: id => get(`/assistant/conversations/${id}/messages`),
  removeConversation: id => del(`/assistant/conversations/${id}`),
  confirm: id => post(`/assistant/actions/${id}/confirm`),
  cancel: id => post(`/assistant/actions/${id}/cancel`)
}

/**
 * 助手对话（SSE）。axios 不支持流式读取，这里用 fetch + ReadableStream。
 * 协议：每个事件为 `data: <json>\n\n`
 * @param {object} body { message, conversationId?, context? }
 * @param {object} opts { onEvent(evt), signal }
 * @returns {Promise<void>} 流结束时 resolve
 */
export function streamChat(body, opts) {
  return streamSse('/api/assistant/chat', body, opts)
}

/** 通用的 SSE POST（助手对话、轻应用生成共用） */
export async function streamSse(url, body, { onEvent, signal } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  const token = getToken()
  if (token) headers.Authorization = 'Bearer ' + token

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })

  // 非流式响应（鉴权失败、参数错误等）
  const ctype = res.headers.get('content-type') || ''
  if (!res.ok || !ctype.includes('text/event-stream')) {
    let message = `请求失败（${res.status}）`
    try {
      const data = await res.json()
      if (data && data.message) message = data.message
    } catch { /* ignore */ }
    const err = new Error(message)
    err.status = res.status
    throw err
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const flush = block => {
    const dataLines = block
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).replace(/^ /, ''))
    if (!dataLines.length) return
    const raw = dataLines.join('\n')
    if (!raw || raw === '[DONE]') return
    try {
      onEvent && onEvent(JSON.parse(raw))
    } catch (e) {
      console.warn('[assistant] 无法解析 SSE 事件', raw, e)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      flush(block)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) flush(buffer)
}
