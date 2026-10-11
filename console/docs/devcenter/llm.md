---
title: 接入大模型
category: 应用能力
order: 22
summary: 应用直接用平台配置好的模型（OpenAI 兼容），密钥不出平台，用量统一统计、可设配额
updated: 2026-10-03
---

# 接入大模型

应用里要用 AI，不需要自己找模型、配密钥。平台提供 **OpenAI 兼容** 的接口，应用把请求发到平台即可：

- 密钥由平台统一托管，应用拿不到
- 模型在「管理 → 模型与 AI」里配，换模型应用不用改
- 每次调用的次数和 token 自动记入「管理 → 应用 → 使用数据 → AI 用量」
- 管理员可以给每个应用设置每日 token 配额

## 端点

```
POST <平台地址>/api/open/llm/chat/completions
```

请求和响应与 OpenAI 的 `chat.completions`完全一致：`messages`、`model`、`temperature`、`tools`、`stream` 等参数都支持。

**鉴权（应用凭证，二选一）**：

- HTTP Basic：`Authorization: Basic base64(client_id:client_secret)`
- OpenAI SDK 风格：把 apiKey 填成 `client_id:client_secret`（平台自动按 Bearer 解析）

凭证在「管理 → 应用 → 登记外部应用」时获得，平台托管的应用由 `yh` 自动注入环境变量。

## 方式一：直接用 OpenAI SDK（最省事）

把 `baseURL` 指到平台的 `/api/open/llm`（注意带 `/llm`，SDK 会自己拼 `/chat/completions`），其余代码一行不用改：

```js
import OpenAI from 'openai'

const openai = new OpenAI({
  baseURL: 'https://你的平台地址/api/open/llm',
  apiKey: `${process.env.YH_CLIENT_ID}:${process.env.YH_CLIENT_SECRET}`
})

// 非流式
const r = await openai.chat.completions.create({
  messages: [{ role: 'user', content: '用一句话介绍电梯维保' }]
})
console.log(r.choices[0].message.content)

// 流式
const stream = await openai.chat.completions.create({
  stream: true,
  messages: [{ role: 'user', content: '写三个日报标题' }]
})
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '')
}
```

错误类型也与 OpenAI 一致（401 `AuthenticationError`、429 `RateLimitError`、404 模型不存在等），SDK 的原有错误处理直接生效。

## 方式二：用以虎 SDK

已经接入统一认证的应用，SDK 上直接有 `llm()`，并且可以带上当前用户的身份：

```js
// Node：模板自带的 yh-one.mjs
const r = await ws.llm({
  messages: [{ role: 'user', content: '你好' }],
  userToken: accessToken   // 可选：统一认证拿到的 access_token
})

// 流式：返回可异步迭代
for await (const ev of await ws.llm({ stream: true, messages: [...] })) {
  // ev 为 OpenAI SSE 的单个对象
}
```

```python
# Python：模板自带的 yh_one.py
r = ws.llm({'messages': [{'role': 'user', 'content': '你好'}]})

# 流式
for ev in ws.llm({'stream': True, 'messages': [...]}):
    ...
```

## 指定模型

不传 `model` 时用平台默认模型。要指定时，`model` 填「管理 → 模型与 AI」里该模型的**模型名**（即调上游用的名称，如 `deepseek-chat`）：

```js
await openai.chat.completions.create({
  model: 'deepseek-chat',
  messages: [...]
})
```

- 模型未配置或未启用 → 404 `not_found_error`
- 模型存在但当前用户的角色不在允许范围内 → 400（带用户 token 调用时才会按角色过滤）

## tools 工具调用

与 OpenAI 用法相同，多轮对话（`tool` 角色回传结果）也可以直接转发：

```js
const r = await openai.chat.completions.create({
  messages: [{ role: 'user', content: '上海今天天气怎么样' }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查城市天气',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
    }
  }]
})
// r.choices[0].message.tool_calls → [{ id, function: { name, arguments } }]
```

流式调用时 `tool_calls` 同样在 SSE 的 delta 中给出。

## 按用户记用量（可选）

服务端到服务端的调用默认只按应用记用量。如果应用是替某个用户发起的，可以带上该用户统一认证拿到的 `access_token`：

- 请求头：`X-User-Token: <access_token>`（以虎 SDK 传 `userToken` 即可）
- 用量会同时记到该用户名下，并按该用户角色过滤可访问的模型
- token 无效、过期或不是签给本应用的 → 401

## 用量与配额

「管理 → 应用 → 使用数据」的「AI 用量」区可以看到：调用次数、Token 总量、失败次数，以及按天 / 按模型 / 按用户的分布。

配额在两个地方设置：

- **全局默认**：「管理 → 模型与 AI → 应用大模型」设每应用每日 token 上限（0 = 不限）
- **单应用覆盖**：「管理 → 应用 → 设置 → AI token 配额」（留空 = 用全局默认，0 = 不限）

达到配额后调用直接返回 **429 rate_limit_error**，在发起真实模型调用之前拦截，不产生上游费用。
