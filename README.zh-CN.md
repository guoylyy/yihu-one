<div align="center">

# 以虎 One

**让企业轻松开发、部署 AI 智能体和应用，并把已有的系统统一接到一个平台上。**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0%20beta-orange.svg)](CHANGELOG.md)
![Platform](https://img.shields.io/badge/runs%20on-macOS%20%7C%20Linux-lightgrey.svg)

[English](README.md) · 简体中文

</div>

---

企业每做一个内部系统，在真正干活之前都要先铺一遍同样的底子：登录、用户和部门数据、服务器、发布流程、备份，现在还要接大模型、让 AI 能用它。而公司已经买来或做好的系统，各有各的账号，各自是一座孤岛。

以虎 One 把这层底子只做一次。它跑在一台机器上（Mac mini 或 Linux 服务器），给企业提供：

### 🤖 开发和发布 AI 智能体

- **不写代码做智能体**：任何人都能用「提示词 + 工具 + 模型」做一个 AI 助手，边做边试，分享给同事或上架全公司
- **能办事的智能体**：每个应用把自己的功能以 MCP 工具提供出来；智能体**以当前用户的身份和权限**调用，写操作先让用户确认
- **一个 MCP 入口通全部**：外部智能体（Claude、Cursor 或你自己的）用个人 API Key 接入 `/api/mcp`，就拿到这个用户能用的所有工具
- **统一托管模型**：OpenAI 兼容（通义、DeepSeek、Kimi、智谱等）或 Anthropic 配一次，智能体和应用共用，可按角色限定、设额度
- **企业知识库**：上传公司文档，智能体回答带出处
- **千人千面首页**：每个人的首页都是自己的——在页面上增删排序卡片，或者对自己的 Agent 说「首页放上待我审批和本月毛利走势」；数据卡片以本人身份调应用的只读 MCP 工具
- **资料中心**：公司的模板、品牌 VI（Logo、色板、字体、规则）、设计组件，带版本和责任人；Agent 经 MCP 拿到结构化的品牌规范，按规范做 PPT、页面
- **Skill 中心**：把 Agent Skill（含 `SKILL.md` 的文件夹，Claude Code、Codex 通用格式）分享给同事或全公司；Agent 经 MCP 一句话上传、安装、检查更新

### 🚀 快速开发和部署应用

- **在自己的 Agent 里一句话发布**：在项目文件夹里对 Claude Code、Codex 等支持 MCP 的 Agent 说「发布到以虎 One」，它判断类型、问你发给谁、发布并告诉你地址，失败时用大白话说原因；审核规则和网页一致
- **从模板到上线两条命令**：`yh new` 生成已接好登录、健康检查和 MCP 的 Node 或 Python 应用，`yh up` 上线
- **推代码即发布**：推到 `release` 分支，平台自动构建、健康检查、上线，失败自动回滚并通知
- **不用为每个应用管服务器**：每个应用一个容器、一个数据库、一个独立网络，统一域名和 HTTPS
- **完全不写代码**：用对话描述一个小工具（报名表、预约、看板），AI 生成一个跑在沙箱里的轻应用

### 🔌 接入已有的系统

- **现成系统不写代码就能统一登录**：平台是标准的 **OpenID Connect 身份提供方**，GitLab、Grafana、Jenkins、Metabase 等自带「通用 OIDC 登录」的系统，填几项配置就接上
- **任何已有系统都能登记进来**——买来的 SaaS、老 ERP、跑在别的服务器上的服务——作为外部应用，原地不动，就能获得：
  - 从工作台统一登录（OIDC / OAuth2），员工不用再记一堆账号
  - 平台的用户和部门主数据
  - 提供 MCP 工具后，进入每个人的 AI 助手
  - 使用平台托管的大模型
- **一个工作台**：在这里做的、别处已有的应用都在一处，同一个应用市场、同一套权限、同一份审计日志
- **用你们公司自己的 VI**：控制台的整套视觉（颜色、字体、圆角、阴影、LOGO）是一个主题，选一套预设、对着公司 VI 调整并实时预览；每个空间（兄弟公司、客户）可以有自己的 VI

> **平台本身不带业务功能**。审批、库存、CRM、考勤……每一个都是应用。控制台只配置用户、登录方式、模型和应用。

> **状态**：测试版（0.1.0，[语义化版本](docs/版本管理.md)，0.x 即 Beta），已在生产环境使用。

## 包含什么

**控制台**（平台自带，只做配置）
- 用户与部门，可从钉钉或飞书同步通讯录
- 登录方式：账号密码、钉钉、飞书、企业微信，可同时打开
- 模型与 AI：OpenAI 兼容（通义、DeepSeek、Kimi、智谱等）、Anthropic、OpenHex；可按角色限定、设每日额度
- 首次打开的浏览器初始化向导、系统设置、审计日志

**应用市场**：四类应用，都有版本和审核

| 类型 | 是什么 | 跑在哪 | 谁能发布 |
| --- | --- | --- | --- |
| AI 助手 | 提示词 + 选定的工具 + 模型 | 控制台的助手运行时 | 所有人 |
| 轻应用 | 用对话让 AI 生成的单页面 | 浏览器沙箱 iframe（不能联网、拿不到登录凭证） | 所有人 |
| 外部应用 | 别处已有的系统 | 它自己的服务器，照样用统一登录和 MCP | 所有人（分享要审核） |
| 代码应用 | 一个 Git 仓库 | 平台上的容器 | 管理员、开发者 |
| Skill | 含 `SKILL.md`、教 Agent 怎么做事的文件夹 | 每个人自己的 Agent | 所有人 |

发布范围可以是仅自己、分享给同事，或经管理员审核后上架全公司市场。员工发布的应用第一次拿用户信息前，要用户确认授权。

**运维**（`yh` 命令行）
- 一条命令安装，开机自启，每晚备份，`yh doctor` 全面自检
- 每个应用独立的 Docker 网络和数据库
- 发布结果推送到飞书 / 钉钉 / 企业微信群机器人
- 平台自身升级，支持离线更新包

## 快速开始

**环境要求**：macOS 或 Linux；Docker 及 compose 插件（macOS 可用 [Colima](https://github.com/abiosoft/colima)），分给 Docker 至少 4G 内存（建议 8G）；`git`、`jq`、`curl`、`openssl`、`rsync`。bash 3.2 及以上，macOS 自带的就行。

### 本机试用（5 分钟）

```bash
git clone https://github.com/guoylyy/yihu-one.git
cd yihu-one
./install.sh --test --demo        # 国内网络再加 --cn
```

打开 http://localhost:18080。测试模式会自动建 `admin` 账号并打印密码，登录页还有「开发登录」可以直接选人。`--demo` 会同时装上两个演示应用（Node、Python）。加 `--lan` 让局域网里的电脑也能打开。用完执行 `./yh destroy` 清掉。

### 给一家公司正式部署

平台机器放在公司内网，公网云服务器只做 HTTPS 和隧道转发（不需要公网 IP）：

```bash
# 平台机器上
./install.sh --company acme --url https://one.example.com --apps-url https://apps.one.example.com \
             --frp-server <云服务器 IP> --cn --demo
# 云服务器上（install.sh 装完会打印这条命令，令牌已经填好）
sudo DOMAIN=one.example.com APPS_DOMAIN=apps.one.example.com FRP_TOKEN=<令牌> INSTALL_DEPS=1 CN=1 ./cloud/install.sh
```

安装脚本会检查机器配置和网络、生成全部密钥、构建并启动平台、装好开机自启和每晚备份、跑一遍自检，最后生成一份**交付单**（验收清单）。然后打开网址，在初始化向导里设置管理员。公司安装用**更新包方式**：什么时候升级由这家公司自己决定（控制台里点「升级」，失败自动回滚），不会因为你推了代码就自动更新。

准备清单、配置要求、国内网络、登录方式配置、验收、交付、升级，见 **[部署手册](docs/部署手册.md)**。

### 装好后体验（15 分钟）

用 `--demo` 装好后，按这个顺序走一遍（[部署手册第 8 节](docs/部署手册.md#8-装好后体验15-分钟)有详细说明）：

1. **工作台** —— 「编辑首页」增删卡片，或者跟 AI 助手说「把我的首页改成……」
2. **应用市场** —— 把演示应用加到工作台再点开：不用再登录，应用拿到的就是当前用户（统一认证）
3. **AI 助手** —— 问「我能用哪些应用？」，再让它调用演示应用的工具；写操作会先让你确认
4. **创作中心** —— 用提示词做一个 AI 助手，或者用一句话生成一个轻应用（比如「团建报名表」）
5. **你自己的 Agent** —— 个人中心新建 API Key，接入 Claude Code / Cursor，在 Agent 里调用平台的全部工具
6. **资料中心与 VI** —— 上传公司品牌规范给 Agent 用；在「系统设置 → 外观与主题」把控制台换成你们公司的 VI

## 工作原理

```
                 https://<你的域名>/
                          │
               ┌──────────▼──────────┐
               │      yh-caddy       │  /apps/<code>/*  → yh-<code>（剥掉前缀）
               └───┬─────────────┬───┘  其余            → yh-console
                   │             │
        ┌──────────▼───┐   ┌─────▼──────┐
        │  yh-console  │   │  yh-<应用> │ …每个应用一个容器，
        │ Node/Express │   │            │   各自独立网络
        │   + Vue 3    │   └────────────┘
        └───┬──────▲───┘
            │      │ /api/platform（平台令牌）
   MySQL ◀──┘      │
   Redis       ┌───┴──────┐
               │ yh agent │  跑在宿主机上，持有 Docker
               └──────────┘
```

- **控制台不碰 Docker**：管理员点「安装 / 发布 / 停用 / 日志」时，控制台只排一条操作；宿主机上常驻的 `yh agent` 领取后执行对应的 `yh` 命令，把日志交回控制台。
- **启动必需的密钥放 `yh.env`**，其余都是控制台里的设置，改了即时生效。
- **自动发布**：agent 跟踪每个应用的 `release` 分支。有新提交 → 备份 → 构建 → 健康检查 → 上线，不通过就回滚并通知。

更多：[架构说明](docs/架构说明.md) · [发布方式](docs/发布方式.md) · [部署手册](docs/部署手册.md)。

## 开发一个应用

代码应用就是一个带 `Dockerfile` 和 `yh-app.json` 的仓库：

```json
{
  "code": "purchase",
  "name": "采购管理",
  "port": 3000,
  "health": "/health",
  "callback": "/sso/callback",
  "mcp": "/mcp",
  "database": true,
  "deploy": { "branch": "release", "mode": "auto" }
}
```

平台把配置（`YH_CLIENT_ID`、`YH_CLIENT_SECRET`、`DATABASE_URL`、`YH_BASE_PATH` 等）注入成环境变量。零依赖的 SDK 一行接好登录：

```js
import express from 'express'
import { Workspace } from './yh-one.mjs'

const app = express()
const ws = new Workspace()
app.use(ws.middleware())            // 挂上 /sso/callback，其余请求要求登录

app.get('/', (req, res) => {
  ws.track(req.yhUser, 'home.view') // 上报使用数据
  res.send(`你好，${req.yhUser.name}`)
})
```

| 级别 | 得到什么 | 要做什么 |
| --- | --- | --- |
| L1 部署 | 跑在平台上，出现在工作台 | 放 `yh-app.json` + `Dockerfile` |
| L2 统一认证 | 点开就是登录状态 | SDK 一行 |
| L3 使用数据 | 知道谁在用什么 | 关键操作处调 `track()` |
| L4 AI | 用户对 AI 助手说一句话就能操作你的应用 | 提供 MCP 端点 |
| L5 大模型 | 应用的 AI 用平台的模型 | OpenAI SDK 改 `baseURL` |

`yh new` 生成的应用已经做好 L1–L2。SDK：[`yh-one.mjs`](console/frontend/public/sdk/yh-one.mjs)（Node 18+）、[`yh_one.py`](console/frontend/public/sdk/yh_one.py)（Python 3.10+，只用标准库）。跑起来的平台在 `/dev` 提供完整的开发中心文档（源文件在 [`console/docs/devcenter/`](console/docs/devcenter/)）。

## 接入已有系统

已有系统不用搬到平台上就能接进来：

1. 管理员在「管理 → 应用 → 登记外部应用」填它的地址、统一认证回调和（可选的）MCP 地址，拿到 client ID、密钥和 OIDC 发现地址
2. 接上登录：
   - **现成系统**（自带「通用 OIDC / OAuth2 登录」设置的）：填发现地址、client ID 和密钥，不用写代码。Grafana 示例和完整字段见 [OIDC 接入](console/docs/devcenter/oidc.md)
   - **自己的系统**：用任意 OIDC 客户端库，Node / Python 可以直接用 SDK。见[统一认证](console/docs/devcenter/sso.md)
3. 可选：从[开放接口](console/docs/devcenter/users.md)读用户和部门、上报使用数据、提供 [MCP 端点](console/docs/devcenter/mcp.md)让智能体能操作它

之后它和其他应用一样出现在工作台和应用市场，遵守同一套可见范围。

## 命令行

| 命令 | 作用 |
| --- | --- |
| `yh init --url <地址>` / `--test` | 首次安装：生成配置和密钥，启动全部服务 |
| `yh start` | 启动平台、控制台和所有应用 |
| `yh new <code> --from node\|python` | 从模板新建应用 |
| `yh add <code> --git <仓库>` / `--path <目录>` | 接入已有应用 |
| `yh up <code>` | 上线：建库 → 登记 → 构建 → 路由 → 健康检查 |
| `yh update <code>` | 拉最新代码重新上线，失败自动回滚 |
| `yh down` / `restart` / `remove <code>` | 停用、重启、移除（移除前先备份） |
| `yh status` / `logs <code>` / `doctor` | 状态、日志、全面自检 |
| `yh backup` / `restore <code> <文件>` | 备份所有数据库；恢复某一个 |
| `yh upgrade` | 平台自身升级 |
| `yh agent` / `autostart` | 运行宿主机 agent；安装开机服务（launchd / systemd） |

完整列表见 `./yh help`。

## 目录

| 路径 | 内容 |
| --- | --- |
| [`yh`](yh) | 命令行（bash，兼容 macOS 自带 bash 3.2） |
| [`console/backend/`](console/backend/) | 控制台后端：Node 20、Express、Prisma、MySQL 8 |
| [`console/frontend/`](console/frontend/) | 控制台前端：Vue 3、Vite、Element Plus |
| [`console/docs/devcenter/`](console/docs/devcenter/) | 开发中心文档，打包进前端 `/dev` |
| [`platform/`](platform/) | Caddy、MySQL、Redis、frpc 的 Docker Compose 编排 |
| [`templates/`](templates/) | 应用模板（Node、Python），已接好统一登录、健康检查、MCP |
| [`cloud/`](cloud/) | 可选：云服务器上的隧道与 HTTPS 入口 |
| [`scripts/`](scripts/) | 自测、打包 |
| [`docs/`](docs/) | 架构、部署、发布文档 |

## 本地开发

```bash
# 控制台后端（需要一个可写的 MySQL 8）
cd console/backend && cp .env.example .env    # 填 DATABASE_URL
npx prisma migrate deploy && npm run dev      # :3105

# 控制台前端
cd console/frontend && npm i && npm run dev   # :5185，/api 代理到 :3105
```

测试：

```bash
cd console/backend && npm test   # 单元测试，不需要数据库
./scripts/selftest.sh            # Docker 里跑全流程（安装 → 应用 → 发布 → 回滚 → 备份）
./scripts/upgrade-test.sh        # 平台升级，不需要 Docker
./scripts/tunnel-test.sh         # 隧道配置，不需要 Docker
```

`selftest.sh` 在临时目录里跑，会占用 18080 端口和 `yh-*` 容器名；已经装了平台的机器上会拒绝运行。

## 参与贡献

欢迎提 Issue 和 Pull Request，见 [CONTRIBUTING.md](CONTRIBUTING.md)。最重要的一条：**控制台只做配置**——只对某一类业务有意义的功能，应该做成应用。

在平台上开发应用？[应用接入规范](docs/应用接入规范.md) 列了应用必须遵守的全部规则，并链到详细文档。

## 安全

请不要在公开 Issue 里报告漏洞，见 [SECURITY.md](SECURITY.md)。

## 许可证

[Apache License 2.0](LICENSE) · Copyright 2026 Yihu Technology (see [NOTICE](NOTICE))
