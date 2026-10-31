---
title: 应用部署规范
category: 入门
order: 3
summary: 应用要满足哪些条件，才能插到以虎 One 上一键部署、自动发布
updated: 2026-10-30
---

# 应用部署规范

插在以虎 One 上的应用，每个跑在一个容器里，地址是 `<平台地址>/apps/<应用code>/`；平台配了**应用独立域名**时是 `<应用域名>/apps/<应用code>/`（和控制台不同源，更安全）。两种情况路径前缀都是 `/apps/<应用code>`，应用代码不用区分；地址以平台注入的 `YH_APP_URL` 为准，不要写死。

你的应用满足下面几条，就能装上平台：开发者在「创作中心 → 新建 → 代码应用」提交仓库，管理员审核通过后平台自动安装；管理员也可以在「管理 → 应用 → 从 Git 安装应用」直接装（或在服务器上 `yh add` + `yh up`）。登记、统一认证凭证、建数据库、路由、健康检查全部自动完成。

## 1. Dockerfile

放在仓库根目录。服务监听环境变量 `PORT`，日志打到标准输出。

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000
CMD ["node", "server.js"]
```

平台跑在 Apple 芯片的 Mac mini 上时，镜像要能在 **arm64** 上运行。Node、Python、Java 官方镜像都支持。

## 2. `/health`

免登录、返回 HTTP 200。平台据此判断应用是否正常：上线、自动发布、日常状态上报都用它，控制台「应用」页的红绿灯就是它。

## 3. `yh-app.json`

应用清单，放在仓库根目录：

```json
{
  "code": "purchase",
  "name": "采购管理",
  "icon": "🛒",
  "category": "业务",
  "description": "采购申请、比价、到货跟踪",
  "version": "1.0.0",
  "port": 3000,
  "health": "/health",
  "callback": "/sso/callback",
  "mcp": "/mcp",
  "database": true,
  "memory": "256m",
  "visibility": null,
  "isDefault": false,
  "env": {},
  "deploy": { "branch": "release", "mode": "auto" },
  "ui": { "responsive": true }
}
```

| 字段 | 说明 |
| --- | --- |
| `code` | 决定地址、容器名、数据库名，**定了不要改**。小写字母开头，只含小写字母、数字、短横线 |
| `name` / `icon` / `category` / `description` | 工作台上显示。每次发布都以清单为准 |
| `version` | **必填**，应用自己的版本号（语义化版本，如 `1.0.0`），每次发版同步更新；安装时校验，缺失装不上。显示在控制台「管理 → 应用」的「版本」列。存量应用没写的尽快补上（没写时显示会退回取源码 `package.json` / `backend/package.json` 的 `version`） |
| `iconColor` | 可选，图标配色，`#RRGGBB`（如 `"#10b981"`）。不写就按名称自动配一个底色 |
| `port` | 容器里监听的端口 |
| `health` | 健康检查路径，默认 `/health` |
| `callback` | 统一认证回调路径，默认 `/sso/callback`（SDK 默认就是它） |
| `entry` | 首页路径，默认 `/` |
| `mcp` | 填了，每个人的 AI 助手就能用你的工具（见 [接入 AI 助手](/dev/mcp)） |
| `database` | `true` 时平台自动建 MySQL 8 库，连接串以 `DATABASE_URL` 传入 |
| `memory` | 容器内存上限，默认 `256m` |
| `cpus` | CPU 上限（核），默认 `1.0` |
| `visibility` / `isDefault` | **只在首次安装时生效**，之后以控制台里的设置为准（管理员可随时改可见范围） |
| `env` | 额外的环境变量（不要放密钥，密钥让管理员写进服务器上的 `apps/<code>/.env`） |
| `deploy` | `branch` 跟踪哪个分支；`mode`：`auto` 自动发布 / `manual` 只通知有新版本，由管理员在控制台点「发布」；`mounts` 声明要读写的宿主目录，见下面 [宿主目录挂载](#宿主目录挂载) |
| `image` | 不用 Dockerfile、直接用现成镜像时填 |
| `ui` | 可选，`{ "responsive": true }` 声明页面已按 [上线检查清单 · 移动端与自适应](/dev/checklist) 适配手机。**新应用应声明为 `true`**（`yh new` 生成的模板已带上）；`yh check` 没看到这个声明会给警告，声明为 `false` 要在上架说明里写明为什么不适配手机 |

`icon` 可以写：

- **仓库里的图片文件**（推荐，最好看）：`"icon": "icon.png"`，路径相对 `yh-app.json` 所在目录。支持 PNG / JPG / GIF / WebP / SVG，不超过 28KB（建议 128×128 的 PNG 或 SVG）。每次发布时平台读这个文件做图标，换图标 = 换文件再发布
- emoji（`"🛒"`）、图片地址（`"https://…/logo.png"`）
- 平台内置图标 `"svg:<名称>"`（如 `"svg:cart"`、`"svg:chart"`、`"svg:money"`，名称和控制台图标选择器里鼠标悬停显示的一致），会按 `iconColor` 着色

管理员也可以在「管理 → 应用 → 设置」里直接给代码应用换图标（上传图片、内置图标、emoji、配色），应用的创建者可以在「创作中心 → 上架信息」里换。**在控制台换过以后，之后的发布不再用清单里的图标覆盖它**；想改回清单里的，点「恢复为代码里的图标」。

## 4. 页面和接口用相对路径

平台把 `/apps/<code>/...` 的请求**剥掉前缀**再转给你的应用，所以服务端路由照常写 `/api/x`、`/sso/callback`，本地开发也不受影响。前缀放在请求头 `X-Forwarded-Prefix` 里（如 `/apps/purchase`），本地直连时没有这个头。

要改的只有「浏览器会拿去请求的地址」：

| 位置 | 不要写 | 要写 |
| --- | --- | --- |
| 前端 `fetch`、链接、表单 | `fetch('/api/list')`、`href="/logout"` | `fetch('api/list')`、`href="logout"` |
| 服务端跳转 | `redirect('/')` | `redirect(prefix + '/')` |
| 会话 cookie | `Path=/` | `Path=<prefix>`（同一域名下有多个应用，限定路径才不会互相覆盖） |

`prefix` 用 SDK 的 `basePathOf(req)`（Node）/ `base_path_of(headers)`（Python）取。用 SDK 做登录的，cookie 路径和登录后跳转 SDK 已经处理好。

单页应用（Vue / React）把构建的 `base` 设为 `./`，路由用 hash 模式，或者读前缀后再设路由 base。

## 5. 运行环境与隔离

- 每个应用有自己的网络：能访问控制台（`http://yh-console:3105`）、MySQL（`yh-mysql`，只能进自己的库）、Redis（`yh-redis`），**访问不到别的应用**。应用之间要协作，经 AI 助手或平台 MCP
- 限制：内存（`memory`）、CPU（`cpus`）、进程数 512、禁止提权
- 员工提交的代码应用不是「可信应用」：用户第一次登录时会看到它要读取哪些信息并确认；统一登录默认只给姓名、账号、角色，要部门或联系方式在创作中心里申请，见 [统一认证](/dev/sso)

## 6. 数据只写两个地方

- 数据库：平台给的 `DATABASE_URL`
- 文件：`/data` 目录（挂载到宿主机 `apps/<code>/data`，备份会带上）

容器里其他位置写的文件，重建容器后就没了。需要缓存可以用平台共用的 Redis：在清单 `env` 里写 `REDIS_URL=redis://yh-redis:6379/<库号>`（库号找管理员分配，只放可丢的数据）。

### 宿主目录挂载

应用要读宿主机上现成的目录（知识库、备份、文件管理），在清单里声明，管理员部署时指定实际路径。**不要要求用户把数据拷进容器**，也不要手改 `compose.yml`（每次 `yh up` 都会重新生成，手改的会被冲掉）。

```json
"deploy": {
  "branch": "release",
  "mode": "manual",
  "mounts": [
    { "name": "library", "container": "/mnt/library", "mode": "ro", "required": false,
      "description": "知识库目录（宿主机上的 Obsidian / 笔记目录）" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `name` | 标识，小写字母开头，只含小写字母、数字、下划线（1~32 位），同一应用内唯一 |
| `container` | 容器内绝对路径。不能是 `/data`（平台保留，`/data/xxx` 可以），不能是容器的系统目录（`/proc` `/sys` `/dev` `/etc` `/usr` `/bin` `/sbin` `/lib` `/lib64` `/boot` 及其子目录）；同一应用内不能重复，也不能互相包含（`/mnt/a` 和 `/mnt/a/b`） |
| `mode` | `ro` 只读（默认）/ `rw` 读写。**要写入必须显式声明 `rw`**，能只读就只读 |
| `required` | `true`：没配置就拒绝部署（`yh up` 报错并给出命令）。`false`（默认）：跳过这个挂载，给警告，应用要能在没有这个目录时正常启动 |
| `description` | 给管理员看的说明，写清楚这个目录里该放什么 |

清单只声明「要一个目录、挂到容器哪里」，**挂宿主机上的哪个目录只由管理员决定**：实际路径存在 `apps/<code>/.env` 的 `YH_MOUNT_<NAME 大写>`（如 `YH_MOUNT_LIBRARY`）。清单的 `env` 里写 `YH_MOUNT_*` 会被忽略。这个变量也会传进容器，但应用读文件用清单里的 `container` 路径就行，宿主路径和应用没关系。

管理员在宿主机的平台目录里配置：

```bash
yh mount <code>                        # 列出声明的挂载和当前值
yh mount <code> library                # 只看一项
yh mount <code> library "/Users/me/智存同步空间"   # 指定并生效（路径有空格要加引号）
yh mount <code> library --clear        # 清除
yh render <code>                       # 把 compose.yml 打到标准输出核对，不构建、不启动
```

指定后立即生效：写 `.env` → 重新渲染 `compose.yml` → `docker compose up -d`，**只重建容器，不重建镜像**，容器重启时正在使用的人会短暂断开。容器按新配置起不来时恢复原来的配置。输出会列出变量、容器路径、只读 / 读写、容器有没有重启，以及目录里有多少文件——**挂错目录是最常见的失误，看一眼数量对不对**。挂载写在配置里，重启、重建、自动发布、平台升级都保留。

控制台不能配置路径（控制台不碰宿主机）：「管理 → 应用」的「运行」列标出 `挂载 1 未配置`（红）/ `挂载 1 已配置`（灰），点开看每个挂载的状态和可复制的命令。从 Git 安装 `required: true` 的应用时，安装会停在这一步（操作失败，日志里有命令），执行 `yh mount` 后自动接着上线。

宿主路径的规则，不满足直接拒绝：

- 绝对路径（`~/` 开头也可以），必须存在且是目录。符号链接按真实路径算，挂的也是真实路径
- 不能是 `/`、用户主目录本身、`~/.ssh`、`~/Library/Keychains` 及其子目录
- 不能是平台目录及其子目录（`yh.env`、各应用的 `.env` 都在里面）
- 不能是上面这些目录的上级（挂 `/Users` 就等于把 `~/.ssh` 也挂进去了）
- 同一个宿主目录不能挂两次
- 路径里不能有 `"` `\` `$` `` ` `` `:` `#` 或换行（compose 没法表示）；目录名真的带这些字符，建一个符号链接也不行（按真实路径算），只能改目录名

几点要知道：

- **`container` 优先用 `/mnt/xxx`，慎用 `/data/xxx`**：不少镜像的入口脚本会 `chown -R /data`（官方 redis 镜像就是）。挂在 `/data` 下时，只读挂载会让容器一启动就退出（`yh mount` 发现后恢复原配置）；**读写挂载更危险，宿主机上原文件的属主会被改掉**
- **宿主目录不在平台的备份范围内**（`yh backup` 只带 `/data` 和数据库），要自己备份
- 宿主目录是活的数据，`rw` 模式下应用改的就是原文件，回滚代码回滚不了这里
- Docker 跑在虚拟机里时（Docker Desktop、colima），目录要在文件共享的范围内，否则挂进去是空的；`yh mount` 发现宿主有文件、容器里是空的会提示
- Docker 安装的平台（`yh` 跑在容器里）看不到宿主机目录，只能按字面检查，路径写错时 Docker 会建一个空目录

## 7. 发布

首次上线要审核（管理员直接装的除外），之后的更新你自己发布：

1. 平时在 `main` 分支开发、提交
2. 要上线时在仓库根目录执行 `./release.sh`：检查分支和改动 → 跑测试 → 通过后把 `main` 推到 `release` 分支
3. 平台（`yh agent`）每 2 分钟检查一次 `release`，发现新提交就备份、构建、上线、健康检查；`/health` 不通过会**自动回滚**到上一版本
4. 结果记在控制台「管理 → 应用 → 操作与发布记录」，配置了通知群的还会发到群里

几点约定：

- **不要直接往 `release` 提交**，只通过 `release.sh` 推
- 回滚只回代码，不回数据库。改表结构要向前兼容（先加字段、后删字段），不兼容的改动先找管理员
- 同一个失败的提交不会反复自动重试，修好后再发布一次即可（管理员也可以在控制台点「发布」手动重试）
- `release.sh` 从 `yh new` 模板自带；老仓库从平台仓库 `templates/release.sh` 复制一份，把开头的 `TEST_CMD` 改成你的测试命令

## 平台自动注入的环境变量

| 变量 | 值 |
| --- | --- |
| `PORT` | 清单里的 port |
| `NODE_ENV` | `production`；测试模式的平台上是 `staging` |
| `YH_CLIENT_ID` / `YH_CLIENT_SECRET` | 统一认证凭证，平台自动登记领取 |
| `YH_APP_URL` | `<平台地址>/apps/<code>`；配了应用独立域名时是 `<应用域名>/apps/<code>` |
| `YH_BASE_PATH` | `/apps/<code>` |
| `YH_WEB_URL` | 平台地址（浏览器跳转授权页） |
| `YH_API_URL` | 控制台的**容器网络**地址 `http://yh-console:3105`（服务端调用，不绕公网） |
| `DATABASE_URL` | 清单里 `database: true` 时 |

[Python SDK](/dev/sdk-python) 和 [Node SDK](/dev/sdk-node) 直接读这些变量，**什么都不用配**。

## 上架前自检：`yh check`

机器能查的先让机器查。`yh check` 只读源码、不起服务，不需要 Docker 和平台（本机没装平台时，单独拿平台仓库里的 `yh` 脚本也能跑，只依赖 bash 和 jq）：

```bash
yh check                 # 检查当前目录
yh check ./purchase      # 检查指定目录；已接入的应用也可以直接写 code（查 apps/<code>/src）
yh check --strict        # 有 ❌ 时退出码非 0，放进 CI / release.sh
yh check --fixed-width 1000   # 「写死宽度」的阈值，默认 900px
```

```
yh check · purchase
  ✅ viewport meta        viewport-fit=cover 已包含（frontend/index.html）
  ✅ 响应式断点           找到 6 处 @media (max-width: 768px / 1024px)
  ✅ 固定宽度             没有写死 ≥900px 的 width / min-width
  ⚠️ 表格降级             frontend/src/views/OrderList.vue 有表格，未见卡片降级（手机端需要卡片列表）
  ✅ 触控尺寸             没发现低于 44px 的按钮 / 链接高度
  ✅ 响应式声明           yh-app.json ui.responsive=true
  ✅ 版本号               yh-app.json version=1.2.0
  ✅ 健康检查             backend/src/index.js 有 /health 路由
  结论：7 项通过，1 项警告，0 项失败
```

| 检查项 | 怎么判断 | 不通过 |
| --- | --- | --- |
| viewport meta | 页面里有 `<meta name="viewport">` 且带 `viewport-fit=cover` | ❌ |
| 响应式断点 | 有 `@media (max-width…)` / `(min-width…)`，或用了 `matchMedia` / `useViewport` | ⚠️ |
| 固定宽度 | `width` / `min-width` 写死 ≥900px（`max-width` 不算） | ⚠️ |
| 表格降级 | 有 `<table>` / `el-table` 的文件里没有 `@media`、`data-label`、`isMobile` 之类的窄屏降级 | ⚠️ |
| 触控尺寸 | 按钮 / 链接的 `height` 低于 44px，或 `<el-button size="small">` | ⚠️ |
| 响应式声明 | 清单 `ui.responsive` 是否为 `true` | ⚠️ |
| 版本号 | 清单有 `version` | ❌ |
| 宿主目录挂载 | 只在声明了 `deploy.mounts` 时检查：写错（路径非法、name 重复、容器路径互相包含）或配了不合格的路径是 ❌，还没配置是 ⚠️ | ❌ / ⚠️ |
| 健康检查 | 有 Dockerfile 时，源码里能找到清单 `health`（默认 `/health`）这个路由 | ❌ |

看的范围：目录下的 `.html` / `.vue` / `.svelte` / `.jsx` / `.tsx`、样式文件，以及带 HTML 的脚本（服务端拼的页面、模板字符串）；跳过 `node_modules`、`dist`、`build` 和平台 SDK。

`yh add`、`yh up` 之前平台会自动跑一遍（不阻断，只提示）。**它只查写法，查不到真实渲染**：通过了也要按清单在 375px 下把每页过一遍；警告是提示不是判决，确认没问题（比如表格的降级写在全局样式里）可以忽略。

## 上线前自检

- [ ] `yh check --strict` 通过（见上一节）

- [ ] 本地 `docker build .` 能过，`docker run -e PORT=3000 -p 3000:3000 <镜像>` 后 `curl localhost:3000/health` 返回 200
- [ ] 没有把密钥写进代码、清单或 Dockerfile
- [ ] 过一遍 [上线检查清单](/dev/checklist)
