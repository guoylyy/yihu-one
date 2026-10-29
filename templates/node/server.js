// __NAME__ —— 以虎 One 平台应用（由 yh new 生成的模板）
// 已接好：统一登录（从平台工作台点开自动登录）、/health 健康检查、使用数据上报、AI 工具（/mcp）
// 开发文档：平台地址 /dev
// 平台入口一半在手机，改动前先看 console/docs/devcenter/checklist.md『移动端与自适应』（首页就是响应式基线：viewport、断点、卡片列表、44px 触控、安全区）
import express from 'express'
import { Workspace } from './yh-one.mjs'

const app = express()
const ws = new Workspace()   // 读 YH_* 环境变量（平台自动注入）；未配置时为匿名模式，方便本地开发

// 健康检查：平台据此判断应用是否正常（必须免登录）
app.get('/health', (req, res) => res.json({ ok: true }))

app.use(ws.middleware({ publicPaths: ['/health', '/mcp'] }))
app.use(express.json())

const esc = (s) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

app.get('/', (req, res) => {
  const u = req.yhUser
  ws.track(u, 'home.view')
  const who = u ? esc(u.name + (u.depts?.[0] ? `（${u.depts[0].name}）` : '')) : '匿名用户（未接入平台）'
  res.send(`<!doctype html>
<!-- 平台入口一半在手机，改动前先看 console/docs/devcenter/checklist.md『移动端与自适应』 -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>__NAME__</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; background: #f5f6f7; }
  /* 正文不小于 14px；内容区限最大宽度、不写死宽度，底部留出操作条的高度 */
  main { max-width: 960px; margin: 0 auto; padding: 16px 16px 96px; }
  h1 { font-size: 20px; margin: 8px 0 4px; }
  .muted { color: #646a73; margin: 0 0 16px; }
  /* 列表：宽屏是多列表格；≤768px 变成「标签 + 值」卡片堆叠，标签取每格的 data-label（纯 CSS，不用 JS） */
  .list { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
  .list th, .list td { padding: 8px 16px; text-align: left; border-bottom: 1px solid #ebedf0; overflow-wrap: anywhere; }
  .list th { font-weight: 500; color: #646a73; background: #fafbfc; }
  @media (max-width: 768px) {
    .list, .list tbody, .list tr, .list td { display: block; width: 100%; }
    .list { background: none; }
    .list thead { display: none; }
    .list tr { background: #fff; border-radius: 8px; padding: 4px 0; margin-bottom: 12px; }
    .list td { display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 0; padding: 4px 16px; text-align: right; }
    .list td::before { content: attr(data-label); color: #646a73; text-align: left; flex-shrink: 0; }
  }
  /* 可点元素至少 44×44px：这是手指触控的最小舒适尺寸（Apple HIG），再小在手机上就容易点错、点不中 */
  .btn, .link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; }
  .link { padding: 0 8px; color: #3370ff; text-decoration: none; }
  .btn { padding: 0 20px; border: 1px solid #3370ff; border-radius: 8px; font: inherit; color: #3370ff; background: #fff; cursor: pointer; }
  .btn.primary { color: #fff; background: #3370ff; }
  /* 底部固定操作条：iPhone 底部有手势条，加上安全区的内边距按钮才不会被挡住（要配合 viewport-fit=cover） */
  .bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: flex-end; gap: 12px; padding: 8px 16px; padding-bottom: calc(8px + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid #ebedf0; }
  @media (max-width: 768px) { .bar .btn { flex: 1; } }
</style>
</head>
<body>
<main>
  <h1>__NAME__</h1>
  <p class="muted">你好，${who}。从这里开始写你的应用（下面是示例数据）。</p>
  <table class="list">
    <thead><tr><th>单号</th><th>事项</th><th>申请人</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>
      <tr><td data-label="单号">A-1001</td><td data-label="事项">办公用品采购</td><td data-label="申请人">张三</td><td data-label="金额">¥1,280.00</td><td data-label="状态">待审批</td><td data-label="操作"><a class="link" href="#">查看</a></td></tr>
      <tr><td data-label="单号">A-1002</td><td data-label="事项">客户拜访差旅</td><td data-label="申请人">李四</td><td data-label="金额">¥3,460.00</td><td data-label="状态">已通过</td><td data-label="操作"><a class="link" href="#">查看</a></td></tr>
      <tr><td data-label="单号">A-1003</td><td data-label="事项">展会物料制作</td><td data-label="申请人">王五</td><td data-label="金额">¥8,900.00</td><td data-label="状态">已驳回</td><td data-label="操作"><a class="link" href="#">查看</a></td></tr>
    </tbody>
  </table>
</main>
<div class="bar"><button class="btn" type="button">导出</button><button class="btn primary" type="button">新建</button></div>
</body>
</html>`)
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
