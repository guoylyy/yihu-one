---
title: Skill 中心
category: 应用能力
order: 24
summary: 把本地 Agent 的 Skill 传到平台、分享给同事、版本更新提醒；Agent 一句话就能上传和安装
updated: 2026-10-10
---

# Skill 中心

**Skill** 是一个文件夹，教 Agent 怎么做一件具体的事，比如「按公司模板写周报」「按法务清单审合同」。它是和应用并列的一等资产：应用跑在平台上，**Skill 由每个人下载到自己的 Agent 里用**（Claude Code、Codex 等），平台负责保存、分发、权限和版本。

## Skill 长什么样

用的是 Agent 通用的格式：文件夹根目录有一个 `SKILL.md`，开头的 frontmatter 写 `name` 和 `description`：

```markdown
---
name: weekly-report
description: 按公司模板写周报。用户说「写周报」「整理本周工作」时使用
version: 1.0.0
---

# 周报

1. 先问清楚这周做了哪些项目……
2. 按 template.md 的结构写……
```

| 字段 | 要求 |
| --- | --- |
| `name` | 必填。小写字母、数字、短横线，最多 64 位。Agent 靠它认出这个 Skill |
| `description` | 必填。一句话说清楚做什么、**什么时候用**，Agent 靠它决定要不要调用；最多 1024 字 |
| `version` | 选填。写了就作为平台上的版本号；不写平台按 v1、v2…… 编号 |

文件夹里还可以放模板、示例、脚本（`scripts/*.py`、`*.sh`）。

**限制**：最多 100 个文件、合计 1MB、单个文件 500KB；不能包含二进制可执行文件（`.exe`、`.so`、`.dylib` 等，改了扩展名也会按文件头识别出来），脚本可以。`.DS_Store`、`__MACOSX`、`.git` 会被自动丢掉。

## 发布

两种方式，审核规则完全一样：

| 发布范围 | 什么时候生效 |
| --- | --- |
| 仅自己 | 马上 |
| 指定同事或部门 | 马上 |
| 上架全公司市场 | 管理员审核通过后（管理员会逐个看文件内容，特别是脚本） |

### 网页上传

「创作中心 → 新建 → Skill」，上传 ZIP 或整个文件夹（ZIP 里多包了一层文件夹也没关系），右上角「发布」。每次发布产生一个版本，「版本」里可以基于任何一个历史版本修改，再发布就是回滚。

### 让你的 Agent 上传

先把平台的 MCP 接到你的 Agent 上（「个人中心」生成 API Key，按页面上的说明配置 `/api/mcp`），然后在 Skill 文件夹里对它说：

> 把这个 Skill 发布到以虎 One，分享给张三。

Agent 会读取文件夹里的文件，调用 `publish_skill`。发布前它应该问你发给谁；同名的 Skill 你发过，会成为它的新版本。

## 安装和更新

在应用市场的 Skill 详情页：

- **复制给 Agent 的安装指令**：粘贴给你的 Agent，它会通过 MCP 取文件，装到本地 Skill 目录（Claude Code 是 `~/.claude/skills/<name>/`）
- **下载 ZIP**：自己解压到 Agent 的 Skill 目录

装好后对 Agent 说「检查一下 Skill 有没有更新」，它会用 `check_skill_updates` 对比本地和平台的版本，有新版本时提示你。**平台不会自动覆盖你本地的 Skill**。

## MCP 工具

| 工具 | 做什么 |
| --- | --- |
| `list_skills` | 我能用的 Skill：自己发布的、分享给我的、市场上架的。返回 id、name、简介、版本、`digest`、发布者 |
| `get_skill` | 取一个 Skill 的全部文件（`skill` 填 id 或 name）。文本文件给原文，其他给 base64 |
| `check_skill_updates` | 传本地的 `[{ name, version 或 digest }]`，返回每个是 `up_to_date` / `update_available` / `not_found` |
| `publish_skill` | 上传（`files` + `scope`，SHARED 时带 `userIds` / `deptIds`）；只改范围时填 `skillId` 不带 `files`。写操作 |

- `digest` 是内容指纹（按路径排序后对路径和内容做 sha256），比版本号更可靠：只要文件一样，指纹就一样
- 所有工具都以**你本人的身份**执行，看不到的 Skill 取不到；`publish_skill` 记审计日志

## 安全

平台只保存和分发 Skill，**不执行它**；但 Skill 会在每个使用者自己的 Agent 里执行。所以：

- 装别人的 Skill 之前，先在详情页看一眼 `SKILL.md` 和脚本
- 上架全公司要管理员审核，审核时看得到全部文件内容
- 别把密码、API Key 写进 Skill 里
