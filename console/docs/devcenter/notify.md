---
title: 应用信息与消息
category: 应用能力
order: 21
summary: 应用取自己所属空间和平台外观；经平台的钉钉 / 飞书 / 企业微信给个人发消息；用平台的钉钉 / 飞书凭证调开放接口
updated: 2026-10-17
---

# 应用信息与消息

两个开放接口，鉴权都是应用凭证（`Authorization: Basic base64(client_id:client_secret)`）。

## 应用信息

```http
GET {YH_API_URL}/api/open/app
```

```json
{ "code": 0, "data": {
  "code": "fde", "name": "FDE 交付管理", "icon": "🧭",
  "space": { "id": 1, "code": "default", "name": "默认空间" },
  "spaces": [{ "id": 1, "code": "default", "name": "默认空间" }],
  "platformUrl": "https://one.example.com",
  "brand": {
    "name": "以虎 One",
    "logo": "https://one.example.com/brand/yihu/logo-mark.svg",
    "theme": { "preset": "yihu", "tokens": { "primary": "#1c1917", "highlight": "#d2521e", "bg": "#faf9f7", "radius": 12 } }
  }
}}
```

- `space`：应用所属的空间；`spaces`：所属空间加上分享给的空间。应用只服务一个空间、又不想按空间分数据时，可以拒绝 `space` 不是本空间的用户登录
- `brand`：所属空间设置了自己的 VI 就是空间的，否则是平台的。应用跟随平台外观时用它：`theme.tokens` 的含义见管理后台「外观与主题」（`primary` 主按钮、`highlight` 强调色……）。`logo` 可能是图片地址，也可能是 `data:` 图片
- 外观改动不会通知应用，建议缓存 10 分钟左右

## 给个人发消息

```http
POST {YH_API_URL}/api/open/notify
Content-Type: application/json

{ "userIds": [36, 52], "title": "新任务指派给你", "content": "**修复登录超时**\n项目：Acme 升级", "url": "https://one.example.com/apps/fde/admin/tasks/128" }
```

| 字段 | 说明 |
| --- | --- |
| `userIds` | 平台用户 id（统一认证的 `id` / OIDC 的 `sub`），一次最多 100 人 |
| `title` | 标题，80 字以内 |
| `content` | 正文，支持简单 markdown，2000 字以内 |
| `url` | 可选，消息上「查看详情」打开的地址 |

响应：

```json
{ "code": 0, "data": {
  "sent": [{ "userId": 36, "channel": "dingtalk" }],
  "skipped": [{ "userId": 52, "reason": "没有绑定可发消息的钉钉 / 飞书 / 企业微信账号，或平台未配置发消息" }]
}}
```

- **只有管理员安装或登记的应用（可信应用）能用**，员工发布的应用调用返回 403
- 平台按这个人绑定的账号选渠道：钉钉 → 飞书 → 企业微信。只发给应用所在空间、在职的人
- 渠道要先在「管理 → 登录方式」配好：
  - **钉钉**：填 **AgentId**（发工作通知要用），应用开通「企业内机器人发送消息」权限
  - **飞书**：应用开启机器人能力，开通「以应用的身份发消息」（`im:message:send_as_bot`）
  - **企业微信**：自建应用的凭证即可，应用的可见范围要包含收消息的人
- 发不出去的人在 `skipped` 里给出原因，不会整体失败。消息是提醒，应用自己的站内通知照常保留

## 用平台的钉钉 / 飞书凭证

应用要直接调钉钉 / 飞书的开放接口（比如拉考勤打卡、审批实例）时，不用在应用里再配一遍 AppKey / Secret：平台「管理 → 登录方式」里配好的那个**企业内部应用**，平台替你换好 access_token。

```http
GET {YH_API_URL}/api/open/channel-token?provider=dingtalk     # 或 feishu
```

```json
{ "code": 0, "data": { "provider": "dingtalk", "accessToken": "…", "expiresAt": "2026-10-17T14:05:00.000Z" } }
```

- 钉钉给的是企业内部应用的 `access_token`，飞书给的是 `tenant_access_token`。有效期约 2 小时，平台有缓存，可以每次调用前都取，或缓存到 `expiresAt` 前几分钟
- **只给可信应用**（管理员安装的托管应用、管理员登记的外部应用），其他应用返回 403；每次发放都记操作日志
- 能调哪些接口取决于管理员在钉钉 / 飞书开发者后台给**这个应用**开了哪些权限（比如考勤要开「考勤打卡结果」读权限）。权限不够时钉钉 / 飞书会直接报错，提示里会写缺哪个权限
- 平台没配这家登录方式时返回 400（「钉钉未配置……」），应用可以退回用自己配的凭证
- 企业微信每个系统应用（打卡、审批……）的 Secret 都不一样，不在这里给；企业微信的打卡要应用自己配「打卡」应用的 Secret

SDK：`await ws.channelToken('dingtalk')`（JS）、`ws.channel_token("feishu")`（Python）。

