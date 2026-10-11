---
title: 用户主数据
category: 身份与认证
order: 11
summary: 账号、姓名、工号、部门、在职状态，各应用以平台为准
updated: 2026-09-28
---

# 用户主数据

**对人以平台为准。**不要在应用里另外维护花名册和部门写法，否则各应用各有一份、很快就对不上。

```http
GET {YH_API_URL}/api/open/users?updatedSince=2026-09-01T00:00:00Z&includeInactive=true
Authorization: Basic base64(client_id:client_secret)
```

| 参数 | 说明 |
| --- | --- |
| `updatedSince` | 只返回这个时间之后有变化的人，做增量同步 |
| `includeInactive=true` | 连已停用的一起返回，处理离职当月的数据要用 |

响应：

```json
{ "code": 0, "data": {
  "generatedAt": "2026-09-28T08:00:00.000Z", "total": 154,
  "list": [{
    "id": 36, "username": "yucc", "name": "于长成", "jobNumber": "E0052", "title": "工艺工程师",
    "mobile": null, "email": null, "active": true, "dingUserId": "…",
    "depts": [{ "id": 24, "name": "前道", "path": "全员/制造中心/前道", "isPrimary": true }],
    "updatedAt": "2026-09-23T22:13:35.277Z"
  }]
}}
```

## 注意

- **只返回你的应用所在空间的人**（平台开了多个空间时）：应用默认只属于一个空间；管理员把应用分享给别的空间后，那些空间的人也会出现在这里。每个人带 `spaceId`，按空间分开数据

- **主键用 `id`**。`username` 只有能用密码登录的人才有；`jobNumber` 来自管理员填写或钉钉通讯录，可能为空。要用工号对人时按字符串精确匹配，对不上的列出来给管理员处理，不要猜
- 部门用 `path`，它是按平台部门树拼出来的完整路径
- 建议每天全量拉一次，或每小时用 `updatedSince` 增量拉
- 用户是管理员在「管理 → 用户与部门」维护的（也可以从钉钉同步）；应用里不要改人
