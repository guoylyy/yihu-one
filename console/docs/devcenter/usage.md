---
title: 使用数据
category: 应用能力
order: 20
summary: 上报用户在应用里做了什么，平台统一看谁在用、用来干什么
updated: 2026-09-28
---

# 使用数据

每个应用都要能回答三个问题：**有多少人在用？用来干什么？谁做了这件事？**平台统一收这些数据，在「管理 → 应用 → 使用数据」和「管理 → 概览」里查看。

## 平台自动记录的（你不用做）

| 事件 | 什么时候 |
| --- | --- |
| `launch` | 用户在平台点开你的应用 |
| `login` | 用户通过统一认证进入你的应用（code 换 token 成功） |

## 你要上报的

在应用里的**关键操作**处上报，比如查询、提交、导出、修改配置。用 SDK 就是一行：

```python
ws.track(user, "quote.compare", {"from": "苏州", "to": "北京朝阳", "weight": 5})
```

```js
ws.track(req.yhUser, 'quote.compare', { from: '苏州', to: '北京朝阳', weight: 5 })
```

SDK 在后台每 3 秒批量发一次，**上报失败只打日志，不影响业务**。

不用 SDK 时直接调接口：

```http
POST {YH_API_URL}/api/open/events
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/json

{ "events": [
  { "userId": 96, "action": "quote.compare", "detail": { "to": "北京市朝阳区", "weight": 5 }, "at": "2026-09-24T08:29:26+08:00" }
]}
```

响应 `{ "accepted": 1, "rejected": [] }`。部分事件不合法时其余照收，`rejected` 里写明第几条、为什么被拒。

| 字段 | 规则 |
| --- | --- |
| `userId` | 统一认证拿到的 `user.id` |
| `action` | 小写字母开头，只含 `a-z 0-9 _ . -`，最长 50。建议 `对象.动作`：`quote.compare`、`order.export`、`config.update` |
| `detail` | 可选，业务摘要，JSON 不超过 2000 字符 |
| `at` | 可选，发生时间，最近 7 天内；不填为收到时间 |

每批最多 200 条。

## 报什么、不报什么

| 报 | 不报 |
| --- | --- |
| 动作、对象、数量、结果（查了哪条线路、导出了几条、改了哪个配置） | 用户粘贴的原文、聊天内容 |
| 从哪个入口来（`"via": "ai"` 表示通过 AI 助手） | 手机号、身份证号、客户联系人 |
| 修改了影响他人的配置（谁改的，改成什么） | 密码、token |

例子：「智能填写」类功能只报识别是否完整，**不报用户粘贴的原文**，因为里面常有手机号。
