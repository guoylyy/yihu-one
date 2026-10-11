---
title: Node SDK
category: SDK 与示例
order: 41
summary: yh-one.mjs，Node 18+ 零依赖，Express 中间件一行接入
updated: 2026-09-28
---

# Node SDK

下载 [`/sdk/yh-one.mjs`](/sdk/yh-one.mjs)，放进项目即可。Node 18+，ESM，**零依赖**。

## 配置

环境变量 `YH_CLIENT_ID`、`YH_CLIENT_SECRET`、`YH_WEB_URL`、`YH_API_URL`、`YH_APP_URL`，或构造时传入 `{ clientId, clientSecret, webUrl, apiUrl, appUrl, basePath }`。没配凭证时不启用。部署到平台时 `YH_BASE_PATH` 由平台注入（见 [部署规范](/dev/deploy) 第 4 节），中间件自动处理路径前缀：cookie 限定在本应用路径下、登录后跳回带前缀的地址。

## Express

```js
import express from 'express'
import { Workspace } from './yh-one.mjs'

const app = express()
const ws = new Workspace()
app.use(ws.middleware())   // 挂上 /sso/callback；其余请求要求登录；/mcp 默认放行（自己校验 token）

app.get('/', (req, res) => {
  ws.track(req.yhUser, 'home.view')
  res.send(`你好，${req.yhUser.name}`)
})
```

`middleware({ publicPaths: ['/mcp', '/health'] })` 可以指定不需要登录的路径。未登录时页面 302 到授权页，`/api/*` 返回 401。

## API

| 方法 | 说明 |
| --- | --- |
| `ws.currentUser(req)` | 已登录的用户，未登录 `null` |
| `ws.beginLogin(req, res, nextPath)` | 跳转授权页（自动带上路径前缀） |
| `basePathOf(req)` | 平台转发的路径前缀，如 `/apps/purchase`；直连时 `''`。服务端自己拼跳转地址时用 |
| `await ws.finishLogin(req, { code, state })` | 回调处理，返回登录后要去的路径 |
| `ws.logout(req)` | 清会话 |
| `ws.track(user, action, detail)` | 上报使用数据 |
| `await ws.userFromToken(authorization)` | MCP 调用的 Bearer token → 用户，无效 `null` |

## MCP

配合官方 `@modelcontextprotocol/sdk`：

```js
app.post('/mcp', express.json(), async (req, res) => {
  const user = await ws.userFromToken(req.headers.authorization)
  if (!user) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: '未授权' }, id: null })
  const server = buildMcpServer(user)   // 工具里按 user 的权限执行
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { transport.close(); server.close() })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
})
```

不想引入 SDK 的话，模板 `templates/node/server.js` 里有一个零依赖的最小 MCP 实现（`yh new` 生成的应用自带）。
