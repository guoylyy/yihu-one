---
title: 统一认证（SSO）
category: 身份与认证
order: 10
summary: OAuth2 授权码模式：跳转授权页、code 换用户身份、会话建议
updated: 2026-10-17
---

# 统一认证（SSO）

平台是身份提供方，你的应用用 **OAuth2 授权码模式**接入。用户的身份来自平台（账号密码、钉钉、飞书或企业微信，由管理员在「登录方式」里配置），你**不需要也不应该**再维护一套账号密码。

> 接的是**现成的系统**（GitLab、Grafana 等自带「通用 OIDC 登录」的），不用写代码，见 [现成系统接入（标准 OIDC）](/dev/oidc)。

## 流程

```
用户浏览器             你的应用                        平台
   │ 打开应用              │                              │
   │ ─────────────────────▶│ 没有会话                      │
   │ ◀── 302 ──────────────│                              │
   │ GET /sso/authorize?client_id&redirect_uri&state       │
   │ ─────────────────────────────────────────────────────▶│ 未登录先登录平台（钉钉 / 飞书 / 企业微信里自动免登）
   │ ◀── 302 redirect_uri?code=…&state=… ─────────────────│
   │ ─────────────────────▶│                              │
   │                       │ POST /api/sso/token ────────▶│ code 换 access_token + 用户信息
   │                       │ ◀────────────────────────────│
   │ ◀── 建立会话 ──────────│                              │
```

用户看到的只是「正在登录 XX…」一闪而过，全程约 1 秒，没有登录页也没有「同意授权」按钮。

## 1. 跳转授权页（浏览器）

```
GET {YH_WEB_URL}/sso/authorize?client_id=<code>&redirect_uri=<回调地址>&state=<随机串>
```

- `state`：你生成的随机串，存在会话里，回调时核对，**防 CSRF，必须做**
- `redirect_uri`：必须与登记的回调地址**同源且路径以它开头**，否则平台拒绝

## 2. code 换身份（你的服务端）

```http
POST {YH_API_URL}/api/sso/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/json

{ "code": "<回调带回的 code>", "redirect_uri": "<与授权时相同>" }
```

也支持把 `client_id`、`client_secret` 放在 body 里，或用 `application/x-www-form-urlencoded`。code **5 分钟内有效、只能用一次**。

响应：

```json
{
  "code": 0,
  "data": {
    "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 7200,
    "user": {
      "id": 96, "username": "chenyt", "name": "陈月婷", "avatar": null, "mobile": null, "email": null,
      "jobNumber": "E0020", "title": "采购工程师", "dingUserId": "…",
      "depts": [{ "id": 21, "name": "采购部", "isPrimary": true }],
      "roles": ["MEMBER"],
      "leaderOf": []
    }
  }
}
```

| 字段 | 用法 |
| --- | --- |
| `id` | **用户主键**，跨系统追溯、上报使用数据都用它 |
| `jobNumber` | 工号，可能为空，不要当主键，见 [用户主数据](/dev/users) |
| `username` | 平台登录账号，只用钉钉登录的人为空 |
| `depts` | 部门（`isPrimary` 为主部门），用于应用内的权限和数据范围 |
| `roles` | 平台角色：ADMIN 管理员 / MEMBER 成员。应用自己的角色在应用里管 |
| `space` | 用户所在空间 `{ id, code, name }`（平台开了多个空间——多家公司或客户——时才有区别）。**应用分享给多个空间时，用它把各空间的数据分开**，别让 A 公司的人看到 B 公司的数据 |
| `leaderOf` | 他担任负责人的部门 id，可以用来自动识别部门主管 |

### 能拿到哪些信息

| 应用 | 用户信息 |
| --- | --- |
| 管理员安装 / 登记的应用（可信） | 全部字段 |
| 员工在创作中心发布的应用 | 基本信息（`id` `username` `name` `avatar` `roles`）+ 申请并经用户同意的：`org`（`depts` `leaderOf` `jobNumber` `title`）、`contact`（`mobile` `email`） |

员工发布的应用，用户第一次登录时平台会展示「这个应用想读取…」，同意后才会跳回你的回调地址；申请的信息变多时会重新确认。没申请的字段不会出现在响应里（`depts` / `leaderOf` 为空数组），代码里要按「可能没有」处理。

## 3. 用 access_token 取用户（可选）

```http
GET {YH_API_URL}/api/sso/userinfo
Authorization: Bearer <access_token>
```

access_token 有效期 2 小时。建立自己的会话后一般用不到它；**平台 AI 助手调你的 MCP 时会带它**，见 [接入 AI 助手](/dev/mcp)。

## 会话建议

- 自己的会话 8 小时左右，过期就再走一次授权（用户无感，平台还在登录状态就是一闪而过）
- Cookie 用 `HttpOnly; SameSite=Lax`
- 接口（`/api/*`）未登录返回 401，页面收到 401 后刷新整页重新走授权，**不要在接口里 302**
- 提供 `/logout`：清掉自己的会话，再 302 到平台的 `{YH_WEB_URL}/logout?redirect=/apps/<code>/`——平台也退出登录、到登录页，换个账号登录后直接回到你的应用（测试不同角色、几个人共用一台电脑都靠它）。SDK：`res.redirect(302, ws.logoutUrl(req))` / `ws.logout_url(headers)`。只清自己会话、不跳平台的话，用户回来时平台还是登录状态，会原样再登进来

## 权限归谁管

平台只负责告诉你**「他是谁」**；**「他能做什么」由你的应用决定**。例如考勤服务：人事科看全员，部门主管看本部门，用户只看自己；没配过角色的默认按最小权限处理。

## 在钉钉 / 飞书 / 企业微信里打开

平台可以作为钉钉 H5 微应用、飞书网页应用、企业微信自建应用在对应客户端里打开（管理员在「登录方式」打开对应的登录），用户免登。你的应用在客户端里也是新窗口打开，流程完全一样，不需要单独适配，也不用接这些平台的 SDK——统一登录返回的都是平台自己的用户。
