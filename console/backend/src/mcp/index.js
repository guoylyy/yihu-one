// MCP Server(Streamable HTTP, 无状态) —— 平台对外的智能体接口
// 鉴权(Authorization: Bearer):
//   ① 个人 API Key(yh_ 前缀, 「个人中心」生成) → 给 Claude / Cursor 等以本人身份使用, 渠道记 MCP
//   ② 用户 JWT(OpenHex 连接器每轮透传) → 渠道记 AI
// 工具与内置助手相同: 控制台通用工具 + 该用户可见应用的 MCP 工具(平台就是一个聚合 MCP 网关)
import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { authenticate } from '../lib/auth.js'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { z } from 'zod'
import { TOOLS, runTool } from '../tools/index.js'
import { loadAppTools } from '../agent/appTools.js'

export const INSTRUCTIONS = [
  '以虎 One 平台工具集。已按凭证绑定用户身份, 所有操作以该用户身份执行, 数据范围和权限按其角色收敛。',
  '包含平台通用工具(身份、应用、同事、部门)和该用户能看到的各应用提供的工具(名字以「应用code__」开头)。',
  '使用约定:',
  '① 不确定当前用户是谁时先调 get_my_profile; 人名先用 search_users 解析成用户 id。',
  '② 标记为写操作的工具调用前, 必须先把要做的事复述给用户并得到明确同意。',
  '③ 返回 403 表示权限不足, 不要重试, 告诉用户需要谁来处理。',
  '④ 日期 YYYY-MM-DD, 时间 YYYY-MM-DD HH:mm。'
].join('\n')

async function buildServer(ctx) {
  const server = new McpServer({ name: 'yihu-one', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  // 应用的工具按用户可见性一并暴露
  const external = await loadAppTools(ctx.user)
  for (const t of [...TOOLS, ...external]) {
    server.registerTool(
      t.name,
      {
        title: t.label,
        description: t.write ? `${t.description}\n【写操作】调用前必须向用户复述并得到确认。` : t.description,
        inputSchema: t.jsonSchema ? z.fromJSONSchema(t.jsonSchema) : t.schema,
        annotations: { title: t.label, readOnlyHint: !t.write }
      },
      async (args) => {
        try {
          const result = t.external
            ? await t.run(ctx, t.jsonSchema ? args : z.object(t.schema).parse(args || {}))
            : await runTool(ctx, t.name, args)
          if (t.write) audit(ctx, `mcp.${t.name}`, { detail: { args } })
          return { content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }] }
        } catch (e) {
          let text = `执行失败: ${e.issues ? e.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ') : e.message}`
          if (e.status === 403) text += '\n提示: 权限不足, 不要重试, 向用户说明需要谁来处理。'
          return { content: [{ type: 'text', text }], isError: true }
        }
      }
    )
  }
  return server
}

/** 须在全局 express.json() 之前挂载 */
export function mountMcp(app) {
  app.post('/api/mcp', express.json({ limit: '10mb' }), authenticate({ allowApiKey: true }), async (req, res) => {
    // 记下是哪个 Agent 在用这个 Key（「个人中心」里显示已接入的 Agent）
    const info = req.body?.method === 'initialize' && req.body.params?.clientInfo
    if (info && req.apiKeyId) {
      const agentName = [info.name, info.version].filter(Boolean).map(String).join(' ').slice(0, 100)
      if (agentName) prisma.apiKey.update({ where: { id: req.apiKeyId }, data: { agentName } }).catch(() => {})
    }
    const server = await buildServer(req.ctx)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close(); server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (e) {
      console.error('[mcp]', e)
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  })
  const notAllowed = (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: '本 MCP 端点为无状态模式，仅支持 POST' }, id: null })
  app.get('/api/mcp', notAllowed)
  app.delete('/api/mcp', notAllowed)
}
