---
title: 快速开始
category: 入门
order: 1
summary: 10 分钟新建一个应用，插到平台上，用平台身份登录
updated: 2026-09-28
---

# 快速开始

目标：10 分钟后，你的应用跑在平台上，用户从工作台点开直接是登录状态，你的代码里能拿到他是谁。

## 1. 从模板新建

模板已经接好统一登录、`/health` 健康检查、使用数据上报。在平台服务器上：

```bash
./yh new purchase --from node --name "采购管理"     # 或 --from python
./yh up purchase
```

完成后打开 `<平台地址>/apps/purchase/`，就是登录状态。代码在 `apps/purchase/src/`，改完再 `./yh up purchase`。

## 2. 放进 Git 仓库，交给平台发布

长期维护的应用放进自己的 Git 仓库（把 `apps/purchase/src/` 的内容作为仓库根目录）：

1. 推到 Gitee / GitHub / GitLab，给平台服务器配好只读的部署公钥
2. 管理员在控制台「管理 → 应用 → 从 Git 安装应用」填仓库地址和 code（第一次安装）
3. 之后你在 `main` 上开发，要上线时执行 `./release.sh`：测试通过后推到 `release` 分支，平台两分钟内自动发布，失败自动回滚

详细要求见 [应用部署规范](/dev/deploy)。

## 3. 在代码里拿到当前用户

Node + Express：

```js
import { Workspace } from './yh-one.mjs'
const ws = new Workspace()          // 读平台注入的 YH_* 环境变量
app.use(ws.middleware())            // 挂上 /sso/callback，其余请求要求登录
app.get('/', (req, res) => res.send(`你好，${req.yhUser.name}`))
```

`req.yhUser` 里有 `id`、`username`、`name`、`depts`、`roles`、`leaderOf` 等，字段见 [统一认证](/dev/sso)。Python 的写法见 [Python SDK](/dev/sdk-python)。

## 4. 本地开发

不配 `YH_*` 环境变量时 SDK 不启用，应用以匿名模式运行，直接 `npm start` / `python app.py` 开发界面和逻辑。要在本地联调登录，在平台上 `yh init --test` 起一套测试环境（有「开发登录」，可以直接选人）。

## 5. 下一步

- 在关键操作处上报使用数据：[使用数据](/dev/usage)
- 让 AI 助手能用你的应用：[接入 AI 助手](/dev/mcp)
- 上线前过一遍 [上线检查清单](/dev/checklist)
