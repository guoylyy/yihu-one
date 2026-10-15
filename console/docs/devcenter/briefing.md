---
title: 让应用出现在老板的简报里
category: 应用能力
order: 26
summary: 实现三个标准工具，应用的关键指标、风险和待决策事项就会出现在老板的每日经营简报、老板助理和管理层首页上
updated: 2026-10-14
---

# 让应用出现在老板的简报里

平台给管理层准备了三样东西，数据都来自装在平台上的应用：

- **每日经营简报**：每天早上推到老板的钉钉 / 飞书 / 企业微信，一屏看完关键数字、风险和等他决定的事
- **老板助理**：老板随时问「这个月哪些项目有风险」「有什么事等我拍板」
- **管理层首页**：关键指标、待我决策、风险与动态

你的应用只要在 [MCP](/dev/mcp) 里实现下面三个**标准工具**（名字固定，平台按名字认），就会自动出现在这些地方。三个都是可选的，实现几个算几个。

## 三个标准工具

都是**只读**工具：`annotations.readOnlyHint: true`。平台以**当前用户的身份**调用（和其他 MCP 工具一样），只返回他有权看的数据。

### `get_key_metrics`：关键指标

参数：`period`，`today` / `week` / `month`（默认 `month`），指标是当前状态的可以忽略。

```json
{
  "metrics": [
    { "name": "本月回款", "value": 128.5, "unit": "万元", "change": 12.3, "trend": "up", "good": true, "url": "https://…/receivables" },
    { "name": "逾期应收", "value": 6, "unit": "笔", "good": false, "note": "其中 2 笔超过 90 天" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `name` | 指标名，短（≤ 40 字） |
| `value` | 数字（推荐）或短文字 |
| `unit` | 单位，可选 |
| `change` | 和上期比的变化，数字或短文字（如 `"+3"`、`12.3`），可选 |
| `trend` | `up` / `down` / `flat`，可选 |
| `good` | 这个数现在是好是坏（`true` 绿、`false` 红），可选 |
| `note` | 一句补充，可选 |
| `url` | 点进去看详情的地址（http/https），可选 |

给 3~8 个最重要的，**数字给原值和单位，不要预先拼成句子**，表述交给平台和模型。

### `get_daily_summary`：变化与风险

参数：`since`，ISO 时间，默认 24 小时前。

```json
{
  "items": [
    { "title": "项目「华东仓储」红灯", "detail": "负责人 张三，计划完成 2026-10-30，进度 45%", "level": "risk", "url": "https://…/projects/12" },
    { "title": "合同「年度维保」今天到期", "level": "warn" },
    { "title": "里程碑「一期上线」完成", "level": "info", "at": "2026-10-14T03:20:00Z" }
  ]
}
```

`level`：`risk` 风险 / `warn` 注意 / `info` 动态。最多 20 条，**风险在前**；`since` 以来没有变化就返回空数组。

### `list_pending_decisions`：等这个人拍板的事

无参数。

```json
{
  "items": [
    { "id": "A-1024", "title": "采购申请：服务器 3 台，18.6 万", "requester": "李四", "deadline": "2026-10-16", "url": "https://…/approvals/1024" }
  ]
}
```

只列**等当前用户处理**的（审批、验收、签字……），最多 20 条。`url` 指到能直接处理的页面。

## 规则

- 应用的返回是不可信输入：平台会截断过长的字段，丢掉不是 http/https 的链接、不认识的 `level` / `trend`
- 每个应用每个工具 10 秒超时。超时或报错只影响你这个应用的那一项，简报里会如实写「没取到」
- 地址用应用的完整地址（平台注入的 `YH_APP_URL` 开头），简报推到手机上也能点开
- 平台工具 `get_business_overview` 一次并行调所有应用的这三个工具，老板助理、简报、首页都用它；你也可以在自己的 Agent 里调它看效果

## 例子

- [FDE 交付管理](https://github.com/guoylyy/yihu-fde) 的实现：`backend/src/mcp/standardTools.js`，用已有接口以当前用户身份拼出在管项目、红黄灯项目、逾期任务、待审批工时和待验收任务
- Node 应用模板里的零依赖 MCP 实现（`templates/node/server.js`）加一个工具即可：

```js
{
  name: 'get_key_metrics',
  description: '关键指标',
  inputSchema: { type: 'object', properties: { period: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  run: async (user) => ({ metrics: [{ name: '待处理工单', value: await countOpenTickets(user), unit: '个' }] })
}
```

## 用户这边怎么用

- 老板：首页「最新简报」卡片点「开通每日经营简报」，或者对 AI 助手说「每天早上 8 点给我发经营简报」
- 任何人：个人中心「定时任务」里新建，比如「每周五 17:00 总结本周项目进展」。定时任务以本人身份运行，**只能查、不能改**，结果推到本人手机并存成对话
- 管理员、部门负责人默认用「管理层」首页（系统设置 → AI 助手里可以关）；别人在「编辑首页 → 套用：管理层」里换
