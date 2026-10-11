---
title: 现成系统接入（标准 OIDC）
category: 身份与认证
order: 12
summary: GitLab、Grafana 等自带「通用 OIDC / OAuth2 登录」的系统，不改代码填几项配置就能用平台统一登录
updated: 2026-10-10
---

# 现成系统接入（标准 OIDC）

平台是一个标准的 **OpenID Connect（OIDC）身份提供方**。很多现成的系统都自带「通用 OIDC / Generic OAuth2 登录」设置，例如 GitLab、Grafana、Jenkins、Metabase、Superset、Nextcloud、Outline、Argo CD。这些系统**不用改代码**，管理员登记一下，再在系统里填几项配置，员工就能用平台账号登录。

自己开发的应用用平台 SDK 更省事，见 [统一认证](/dev/sso)。两种方式用的是同一套应用登记、回调地址校验、可见范围和授权确认。

## 1. 在平台登记

管理员在「管理 → 应用 → 登记外部应用」里：

- **回调地址**：填这个系统的 OIDC 回调地址（每个系统不一样，在它的文档里找，例如 Grafana 是 `https://<grafana 地址>/login/generic_oauth`）
- 保存后弹出 **Client ID**、**Client Secret**（只显示一次）和 **OIDC 发现地址**

员工在「创作中心」登记的外部应用也能这样接，按授权范围收敛字段（见下文「能拿到哪些字段」）。

## 2. 在系统里填配置

大多数系统只要填发现地址，其他自动获取：

| 配置项 | 值 |
| --- | --- |
| 发现地址（Discovery / Issuer URL） | `{平台地址}/.well-known/openid-configuration`（Issuer 填 `{平台地址}`） |
| Client ID / Client Secret | 登记时拿到的 |
| Scopes | `openid profile email`，要部门再加 `groups` |
| 用户名字段 | `preferred_username` |
| 显示名字段 | `name` |
| 邮箱字段 | `email` |

要手动填各个端点的系统：

| 端点 | 地址 |
| --- | --- |
| 授权 Authorization | `{平台地址}/sso/authorize` |
| Token | `{平台地址}/api/oidc/token` |
| 用户信息 UserInfo | `{平台地址}/api/oidc/userinfo` |
| 公钥 JWKS | `{平台地址}/api/oidc/jwks` |

`{平台地址}` 是「系统设置 → 基本信息 → 访问地址」，也就是员工浏览器里打开平台的地址。**Issuer 必须和它完全一致**（协议、域名、端口都一样、末尾不带 `/`），否则客户端会拒绝。

> 系统的服务端要能访问 Token 和用户信息端点。和平台在同一台机器的 Docker 里时，可以把这两个地址换成 `http://host.docker.internal:<端口>/...`，授权地址仍然填浏览器能打开的平台地址。

## 能拿到哪些字段

| Scope | 字段 | 说明 |
| --- | --- | --- |
| `openid` | `sub` | 平台用户 id（字符串），**用它做主键**，不会变 |
| `profile` | `name` `preferred_username` `picture` `roles` `space` `space_name` | `roles` 是平台角色数组：`ADMIN` / `DEVELOPER` / `MEMBER`；`space` 是用户所在空间的 code（多公司 / 客户时用来分开数据） |
| `email` | `email` `email_verified` | 需要 `contact` 信息范围 |
| `phone` | `phone_number` `phone_number_verified` | 需要 `contact` 信息范围 |
| `groups` | `groups` | 部门名称数组，需要 `org` 信息范围 |

- 管理员登记的应用能拿全部字段；员工发布的应用只能拿申请并经用户同意的范围，和 [统一认证](/dev/sso) 里「能拿到哪些信息」一样
- 邮箱、手机号只能由管理员或通讯录同步填写，用户自己改不了，所以 `email_verified` 为 `true`
- 用户没有填邮箱 / 手机号时不返回这个字段。**有些系统要求必须有邮箱**，接入前先确认用户都有邮箱

## 支持什么

| 能力 | 说明 |
| --- | --- |
| 授权码模式 | `response_type=code`，`response_mode=query` |
| PKCE | `S256`、`plain`；带了 `code_challenge` 的，换 token 时必须带正确的 `code_verifier` |
| 客户端认证 | `client_secret_basic`、`client_secret_post` |
| id_token | RS256 签名，有效期 2 小时，带 `nonce`（授权时传了的话） |
| access_token | 2 小时，同时能用于平台的 `/api/sso/userinfo` 和 [MCP](/dev/mcp) |
| 拒绝授权 | 用户在授权确认页点「不同意」，跳回系统并带 `error=access_denied` |

暂不支持：`refresh_token`（过期后再走一次授权，平台还在登录状态时用户无感）、implicit / hybrid 模式、`prompt=none`、单点登出（`end_session_endpoint`）。

## 例：Grafana

已实测（Grafana 11）。在 `grafana.ini` 的 `[auth.generic_oauth]` 里，或者用环境变量：

```ini
[auth.generic_oauth]
enabled = true
name = 以虎 One
client_id = grafana
client_secret = <Client Secret>
scopes = openid profile email groups
auth_url = https://one.example.com/sso/authorize
token_url = https://one.example.com/api/oidc/token
api_url = https://one.example.com/api/oidc/userinfo
use_pkce = true
login_attribute_path = preferred_username
name_attribute_path = name
# 平台管理员 → Grafana Admin，其他人 Viewer
role_attribute_path = contains(roles[*], 'ADMIN') && 'Admin' || 'Viewer'
```

平台里登记的回调地址填 `https://<grafana 地址>/login/generic_oauth`。

> Grafana 自带一个本地账号 `admin`。平台里也有叫 `admin` 的用户时，第一次登录会报「User sync failed」（用户名冲突）。把 Grafana 的本地管理员改个名（`[security] admin_user`）就好。

## 常见问题

| 现象 | 原因 |
| --- | --- |
| `issuer mismatch` / `unexpected iss` | 系统里填的地址和「访问地址」不完全一致（多了 `/`、http 和 https 不同、用了内网 IP） |
| `invalid_client` | Client Secret 不对，或在平台里重置过 |
| `invalid_grant: redirect_uri 与授权时不一致` | 系统里配置的回调地址和登记的不一样 |
| 授权页显示「redirect_uri 不在该应用登记的回调地址中」 | 回调地址没登记，或协议 / 域名 / 端口不同 |
| 授权页显示「你没有使用 XX 的权限」 | 应用设了可见范围，这个人不在范围内 |
