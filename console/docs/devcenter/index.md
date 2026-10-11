---
title: 以虎 One 开发中心
category: 入门
order: 0
summary: 应用怎么插到以虎 One 上：部署、统一认证、使用数据、AI 助手
updated: 2026-09-30
---

# 以虎 One 开发中心

以虎 One 是一个只做配置的基础平台：它提供统一登录、用户与组织、模型与 AI 助手，**具体的业务功能全部由插在上面的应用提供**。你开发的每个应用插上来之后：

- 用户从工作台点开就是已登录状态，不用单独开账号
- 你能知道是谁在用、用来做什么
- 应用提供 MCP 工具后，每个人的 AI 助手自动获得这些能力
- 推送代码到 `release` 分支就自动上线，失败自动回滚

**不会写代码也能做应用**：在「创作中心」做 AI 助手、用对话生成轻应用，见 [创作中心](/dev/studio)。

每篇文档的地址都是固定的（`/dev/<名称>`），可以放心贴到代码注释和群聊里。

## 接入分几级

按顺序往下做。**L1 + L2 是所有应用的最低要求**，用模板新建的应用已经全部做好。

| 级别 | 做到什么 | 用户的体验 | 你要做的 | 文档 |
| --- | --- | --- | --- | --- |
| **L1 部署** | 应用跑在平台上，出现在工作台 | 能找到它 | 仓库里放 `yh-app.json` + `Dockerfile` | [应用部署规范](/dev/deploy) |
| **L2 统一认证** | 用平台身份登录 | 点开就进，不用登录 | SDK 一行搞定 | [统一认证](/dev/sso) |
| L3 使用数据 | 上报用户在应用里做了什么 | 无感 | 在关键操作处调 `track()` | [使用数据](/dev/usage) |
| L4 AI | 提供 MCP 工具 | 对 AI 助手说一句话就能用 | 实现一个 MCP 端点 | [接入 AI 助手](/dev/mcp) |
| L5 大模型 | 应用的 AI 用平台托管的模型 | 无感 | OpenAI SDK 改个 baseURL | [接入大模型](/dev/llm) |

**不跑在平台上的已有系统**（买来的 SaaS、其他服务器上的系统）也能接：管理员在「管理 → 应用 → 登记外部应用」登记，它照样能用统一认证和 MCP。自带「通用 OIDC 登录」的现成系统（GitLab、Grafana 等）**不用改代码**，见 [现成系统接入（标准 OIDC）](/dev/oidc)。

## 从哪里开始

- 第一次接入：[快速开始](/dev/quickstart)，10 分钟
- 用自己的 Agent（Claude Code、Codex 等）一句话发布：[用 Agent 发布](/dev/agent-publish)
- 用 Python：[Python SDK](/dev/sdk-python)；用 Node：[Node SDK](/dev/sdk-node)
- 上线前：[上线检查清单](/dev/checklist)

## 文档目录

**入门**：[创作中心](/dev/studio) · [快速开始](/dev/quickstart) · [应用部署规范](/dev/deploy) · [用 Agent 发布](/dev/agent-publish) · [上线检查清单](/dev/checklist)
**身份与认证**：[统一认证 SSO](/dev/sso) · [用户主数据](/dev/users) · [现成系统接入（标准 OIDC）](/dev/oidc)
**应用能力**：[使用数据](/dev/usage) · [接入 AI 助手（MCP）](/dev/mcp) · [接入大模型](/dev/llm) · [轻应用 SDK](/dev/lite) · [Skill 中心](/dev/skills) · [资料中心](/dev/assets)
**SDK 与示例**：[Python SDK](/dev/sdk-python) · [Node SDK](/dev/sdk-node)
**参考**：[错误与常见问题](/dev/faq) · [变更记录](/dev/changelog)

## 找谁

插应用、审核、要测试账号：平台管理员（「管理 → 应用」「管理 → 审核与市场」）。文档有问题或需要新接口：直接问 AI 助手，或者联系平台负责人。
