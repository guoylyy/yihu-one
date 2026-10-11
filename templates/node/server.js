// __NAME__ —— 以虎 One 平台应用（由 yh new 生成的模板）
// 已接好：统一登录（从平台工作台点开自动登录）、/health 健康检查、使用数据上报、AI 工具（/mcp）
// 开发文档：平台地址 /dev
import express from 'express'
import { Workspace } from './yh-one.mjs'

const app = express()
const ws = new Workspace()   // 读 YH_* 环境变量（平台自动注入）；未配置时为匿名模式，方便本地开发

// 健康检查：平台据此判断应用是否正常（必须免登录）
app.get('/health', (req, res) => res.json({ ok: true }))

app.use(ws.middleware({ publicPaths: ['/health', '/mcp'] }))
app.use(express.json())

app.get('/', (req, res) => {
  const u = req.yhUser
  ws.track(u, 'home.view')
  res.send(`<meta charset="utf-8"><title>__NAME__</title>
<body style="font:15px system-ui;padding:24px">
<h2>__NAME__</h2>
<p>你好，${u ? u.name + (u.depts?.[0] ? `（${u.depts[0].name}）` : '') : '匿名用户（未接入平台）'}</p>
<p>从这里开始写你的应用。</p></body>`)
})

// ---------- AI 工具（MCP） ----------
// 清单里写了 "mcp": "/mcp"，平台上每个能看到本应用的人，他的 AI 助手就能调用这里的工具
// 这是一个零依赖的最小实现（无状态 Streamable HTTP，只回 JSON）；工具多了建议换官方 SDK @modelcontextprotocol/sdk
// 平台调用时带 Bearer access_token，用 ws.userFromToken() 换成是谁在用
const TOOLS = [
  {
    name: 'whoami',
    title: '我是谁',
    description: '返回当前用户在「__NAME__」里的身份。演示用，改成你的应用真正能做的事。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true }, // 只读工具助手直接调用；不声明只读的会先弹确认卡片
    run: (user) => ({ app: '__NAME__', user: user ? { id: user.id, name: user.name, depts: user.depts } : null })
  }
]

app.post('/mcp', async (req, res) => {
  const { id, method, params } = req.body || {}
  const reply = (result) => res.json({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => res.json({ jsonrpc: '2.0', id, error: { code, message } })
  if (id === undefined) return res.status(202).end() // 通知（如 notifications/initialized）不用回
  if (method === 'initialize') {
    return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: '__CODE__', version: '0.1.0' } })
  }
  if (method === 'ping') return reply({})
  if (method === 'tools/list') return reply({ tools: TOOLS.map(({ run, ...t }) => t) })
  if (method === 'tools/call') {
    const user = await ws.userFromToken(req.headers.authorization)
    if (ws.enabled && !user) return fail(-32001, '未授权：需要平台签发的 access_token')
    const tool = TOOLS.find(t => t.name === params?.name)
    if (!tool) return fail(-32602, `没有工具 ${params?.name}`)
    try {
      const out = await tool.run(user, params.arguments || {})
      ws.track(user, `mcp.${tool.name}`)
      return reply({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out })
    } catch (e) {
      return reply({ content: [{ type: 'text', text: e.message }], isError: true })
    }
  }
  return fail(-32601, `不支持 ${method}`)
})

const port = Number(process.env.PORT) || 3000
app.listen(port, () => console.log(`[__CODE__] listening on :${port}`))
