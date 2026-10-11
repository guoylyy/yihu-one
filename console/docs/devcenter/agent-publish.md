---
title: 用 Agent 发布
category: 入门
order: 4
summary: 在自己的 Agent（Claude Code、Codex 等）里一句话把应用、Skill 发到平台上：接入、发布指令、MCP 工具
updated: 2026-10-10
---

# 用 Agent 发布

不用打开控制台、不用找管理员：在项目文件夹里对你的 Agent 说一句「把它发布到以虎 One」，它会判断项目类型、问你发给谁，然后发布、把地址告诉你。

Agent 以**你本人的身份**发布，审核规则、可见范围、谁能发什么，和在「创作中心」里点「发布」**完全一样**——MCP 只是多了一个入口。

## 1. 接入（只做一次）

1. 「个人中心 → 我的 API Key」→ 创建一个 Key
2. 按「个人中心 → MCP 接入说明」把平台加到你的 Agent：
   - **Claude Code**：复制页面上那条 `claude mcp add …` 命令，把 `<你的 API Key>` 换成刚才的 Key 执行
   - **其他 Agent**（Codex、Cursor、Cherry Studio 等）：按它的文档添加一个 Streamable HTTP 的 MCP，地址 `{平台地址}/api/mcp`，请求头 `Authorization: Bearer <你的 API Key>`
3. 回到「个人中心」，API Key 列表的「接入的 Agent」一栏会显示是哪个 Agent 在用这个 Key

## 2. 发布

「创作中心 → 让 Agent 帮我发布」复制那段指令，在项目文件夹里粘给 Agent。它会：

1. 调 `list_my_published` 看你能发什么、这个项目是不是已经发过（发过就出新版本）
2. 判断类型：

   | 项目 | 发成 |
   | --- | --- |
   | 有 `SKILL.md` 的文件夹 | Skill（`publish_skill`），见 [Skill 中心](/dev/skills) |
   | 单个 HTML 文件的小工具 | 轻应用（跑在沙箱里，存数据、调 AI 用 `window.yh`，见 [轻应用 SDK](/dev/lite)） |
   | 有 `Dockerfile` 和 `yh-app.json` 的服务 | 代码应用（代码要先推到 Git；只有开发者能发，每次都要管理员审核），见 [应用部署规范](/dev/deploy) |
   | 已经部署在别处的系统 | 外部应用（填地址；要统一登录、AI 工具再填回调和 MCP 地址） |

3. 名称、简介、图标你没说的，给你几个建议让你选；外部应用 / 代码应用的 code 先用 `check_app_code` 查重，冲突了会给替代建议
4. **问你发给谁**：仅自己 / 指定同事或部门 / 上架全公司，并告诉你哪种要审核
5. 发布，把访问地址告诉你；代码应用审核通过后由平台自动安装，它用 `publish_status` 跟进，失败时用大白话告诉你原因

发布后在「创作中心」里也能看到、接着改；Agent 随时可以帮你改范围（`set_app_visibility`）。

## 3. 审核规则（和网页一致）

| | 仅自己 | 指定同事 / 部门 | 上架全公司 |
| --- | --- | --- | --- |
| 轻应用、AI 助手、Skill | 马上生效 | 马上生效 | 要审核 |
| 外部应用 | 马上生效 | 要审核 | 要审核 |
| 代码应用 | 每次都要审核，通过后平台安装 | | |

要审核的，审核通过前用户看到的仍是上一个生效的版本和范围。

## MCP 工具

| 工具 | 做什么 | 写操作 |
| --- | --- | --- |
| `list_my_published` | 我能发哪些类型（`canPublish`）、发布规则、我发过的应用和 Skill（含地址） | |
| `check_app_code` | code 能不能用；被占用 / 保留字时给可用的建议 | |
| `publish_app` | 发布轻应用（`html`）、外部应用（`url`）、代码应用（`git`）；`appId` 填了就是出新版本 | ✅ |
| `publish_status` | 是否生效、地址、审核状态（被打回时带原因）、代码应用的安装进度和失败原因 | |
| `set_app_visibility` | 改发布范围（应用和 Skill 都行） | ✅ |
| `publish_skill` 等 | Skill 相关，见 [Skill 中心](/dev/skills) | |

写操作的 Agent 会先向你复述并等你确认；所有通过 MCP 的发布都记在审计日志里，渠道是 MCP。

## 常见问题

| 现象 | 原因 |
| --- | --- |
| `代码应用只有管理员和开发者能提交` | 你不是开发者角色。单页面的小工具可以发成轻应用；正式系统找管理员开开发者角色 |
| `xxx 已被占用。可以用：…` | code 冲突，选一个建议的；代码应用记得同时改仓库里 `yh-app.json` 的 code |
| `上架前先在「上架信息」里写一句简介` | 上架市场要有简介；让 Agent 带上 `description` 再发 |
| 代码应用 `deployment.status` 一直是「排队中」 | 平台机器上的 `yh agent` 没在运行，找管理员 |
