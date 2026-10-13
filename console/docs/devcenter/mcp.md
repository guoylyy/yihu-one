---
title: 接入 AI 助手（MCP）
category: 应用能力
order: 22
summary: 提供 MCP 工具，用户对平台 AI 助手说一句话就能用你的应用
updated: 2026-09-28
---

# 接入 AI 助手（MCP）

平台给每个用户配了一个 AI 助手。你的应用提供一个 MCP 端点后，**能看到这个应用的用户**，他的助手就会自动获得你的工具（名称前缀 `应用code__`）。例如快递询价应用接入后，用户问「寄 3 公斤样品到广州天河走哪家最便宜」，助手会直接调快递询价的工具回答。平台本身就是一个聚合 MCP 网关：每个应用只管自己的工具，平台负责按用户可见范围汇总、带上用户身份转发。

## 步骤

1. 实现一个 MCP 端点（Streamable HTTP），推荐**无状态模式、只回 JSON**
2. 在 `yh-app.json` 里写 `"mcp": "/mcp"`，发布后平台自动登记（外部应用由管理员在「登记外部应用」里填 MCP 地址）
3. 在平台问 AI 助手一句相关的话验证

## 身份

平台调你的 MCP 时带 `Authorization: Bearer <access_token>`，它代表**当前用户**，与统一认证签发的是同一种 token。用 `GET /api/sso/userinfo` 换成用户信息（SDK 的 `userFromToken` / `user_from_token`，自带 5 分钟缓存），然后**按这个用户的权限**执行。拿不到用户就返回 401，不允许匿名。

## 只读与写操作

| 工具 | 声明 | 助手的行为 |
| --- | --- | --- |
| 查询类 | `annotations.readOnlyHint: true` | 直接调用 |
| 会改数据的 | 不声明，或 `readOnlyHint: false` | 先给用户弹**确认卡片**，用户点「确认」后才调用 |

**没声明只读的一律当写操作处理。**

## 工具怎么设计

- 名称用动词开头的 snake_case：`compare_express_price`、`list_shipments`、`create_shipment`
- `description` 写清楚什么时候用、参数怎么填、返回什么，这是给模型看的说明书；参数的 `description` 也要写
- 参数尽量宽容：地名、日期允许用户随口说的写法，由你的应用解析
- 返回简洁的 JSON，单次控制在几 KB；出错返回 `isError: true` 和人能看懂的原因（如「只有仓库主管能取消发货单」）
- 通过 MCP 做的操作同样要[上报使用数据](/dev/usage)，`detail` 里加 `"via": "ai"`
- 工具数量：平台自带的工具加上用户能看到的所有应用的工具，超过 60 个时，内置 AI 助手不再把**工具多的应用**逐个列给模型（模型一次能接的工具有上限，太多也容易选错），改成先用 `find_app_tools` 按关键词查、再用 `call_app_tool` 调用；确认卡片、审计和直接调用一样。所以 `description` 里要写上用户会说的词（「工时」「请假」「发货」），查得到才用得上。通过 MCP 接入的 Agent（Claude Code 等）照常拿到全部工具

## 最小实现

`yh new <code> --from node` 生成的应用自带一个零依赖的最小实现（`server.js` 里的 `/mcp`，一个 `whoami` 示例工具），照着加工具即可；工具多了换官方 `@modelcontextprotocol/sdk`，写法见 [Node SDK](/dev/sdk-node)。

没有 MCP SDK 的环境（比如只用 Python 标准库）也可以手写，无状态模式只需要处理三个 JSON-RPC 方法：`initialize`、`tools/list`、`tools/call`；通知类消息（没有 `id`）直接回 202。Node 模板里的 `/mcp` 就是这么写的，约 40 行。

## 让工具能放到首页上

每个人的首页可以放**数据卡片**：以这个人的身份调你的一个**只读**工具，把结果显示成数字、列表、表格或折线（用户在首页「编辑首页 → 添加卡片」里选，或让自己的 Agent 用 `set_my_home` 配）。想让你的应用出现在同事的首页上（「待我审批」「本月毛利走势」），只读工具这样设计：

- **结果小而直接**：返回数组（每项是扁平对象，如 `[{ "title": "…", "applicant": "…", "days": 2 }]`）或 `{ total, list }`；首页最多显示 8～10 行，参数里给 `limit`
- **数字类指标单独一个工具**，直接返回数字或 `{ total }`
- **趋势类**返回按时间排好序的数组，字段名简单（`[{ "month": "2026-09", "profit": 12.3 }]`），用户选折线图时填 `x = month`、`y = profit`
- 必须标 `readOnlyHint: true`（写操作工具不能放到首页）；15 秒内返回

## 让用户本人的 AI 工具也能用

用户可以在平台「个人中心」生成 API Key，让 Claude、Cursor 等以他的身份访问平台 MCP（`/api/mcp`）。你的应用的工具也会出现在那里（同样按可见范围和他本人的身份）。
