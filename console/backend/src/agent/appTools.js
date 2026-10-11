// 外部应用的 MCP 工具并入 AI 助手
// 应用登记了 mcpUrl(清单里的 mcp 字段)后, 能看到这个应用的用户, 他的助手就能用这个应用的工具
// 调用时以「应用 access_token」携带用户身份(与 SSO 同一种 token), 应用侧用 /api/sso/userinfo 即可识别是谁
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import prisma from '../lib/prisma.js'
import { signAppToken } from '../lib/auth.js'
import { visibleTo } from '../services/apps.js'

const LIST_TTL = 5 * 60_000
const listCache = new Map() // appCode -> { at, tools }

const safeName = (s) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)

async function withClient(app, userId, fn) {
  const transport = new StreamableHTTPClientTransport(new URL(app.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${signAppToken(userId, app.code)}` } }
  })
  const client = new Client({ name: 'yihu-one', version: '0.1.0' })
  await client.connect(transport)
  try {
    return await fn(client)
  } finally {
    client.close().catch(() => {})
  }
}

const timeout = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), ms))])

/**
 * 用户可见的、配置了 MCP 的应用的工具, 转换成注册表同构的定义
 * 按「可见」而不是「放没放到工作台」: 工作台上摆哪些图标是个人偏好, 不该决定 AI 能不能用这个应用
 * 某个应用连不上只跳过它, 不影响助手
 */
export async function loadAppTools(user) {
  const apps = (await prisma.app.findMany({
    where: { deletedAt: null, status: 'ACTIVE', mcpUrl: { not: null } }
  })).filter(a => visibleTo(a, user))
  const out = []
  for (const app of apps) {
    let tools = listCache.get(app.code)
    if (!tools || Date.now() - tools.at > LIST_TTL) {
      try {
        const r = await timeout(8000, withClient(app, user.id, c => c.listTools()))
        tools = { at: Date.now(), tools: r.tools || [] }
        listCache.set(app.code, tools)
      } catch (e) {
        console.warn(`[appTools] ${app.code} MCP 不可用:`, e.message)
        continue
      }
    }
    for (const t of tools.tools) {
      const readOnly = t.annotations?.readOnlyHint === true
      out.push({
        name: safeName(`${app.code}__${t.name}`),
        label: `${app.name}：${t.title || t.annotations?.title || t.name}`,
        description: `[应用：${app.name}] ${t.description || ''}`,
        jsonSchema: { ...(t.inputSchema || { type: 'object', properties: {} }) },
        write: !readOnly,
        // 外部应用的工具没声明只读的, 一律要用户确认
        confirm: !readOnly,
        summarize: async (a) => {
          const props = t.inputSchema?.properties || {}
          const parts = Object.entries(a || {}).map(([k, v]) => `${props[k]?.title || props[k]?.description?.split(/[，,（(]/)[0] || k}：${typeof v === 'object' ? JSON.stringify(v) : v}`)
          return `在「${app.name}」${t.title || t.annotations?.title || t.name}：${parts.join('；')}`.slice(0, 1000)
        },
        run: async (ctx, a) => {
          const r = await timeout(60_000, withClient(app, ctx.user.id, c => c.callTool({ name: t.name, arguments: a })))
          const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
          if (r.isError) throw new Error(text || '应用返回错误')
          return r.structuredContent ?? text
        },
        external: true,
        appCode: app.code,
        appName: app.name
      })
    }
  }
  return out
}
