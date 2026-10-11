# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 以虎 One 开发指南

只做配置的基础平台：`yh` 命令行管部署，`console/` 是平台自带的控制台（配置模型、登录、用户，插拔应用）。先读 `docs/架构说明.md`（边界、应用市场、控制台↔宿主机、数据模型），部署相关读 `docs/发布方式.md`、`docs/部署手册.md`。

**改代码按最高标准对待**：这是很多项目的底座，改前想清楚对存量接入的影响，改后必须过 `scripts/selftest.sh`。

## 技术栈

- `yh`：bash，**必须兼容 macOS 自带 bash 3.2**（没有关联数组、`${var,,}`、`BASHPID`、`mapfile`；变量后面紧跟中文或全角标点要写成 `${var}`，否则会被解析错）。子命令分发在文件末尾的 `case`
- 控制台后端 `console/backend/`：Node 20+、Express 4、Prisma 6、MySQL 8，ESM，端口 3105
- 控制台前端 `console/frontend/`：Vue 3、Vite、Element Plus、Pinia，端口 5185（`/api` 代理到 3105）
- 开发中心文档 `console/docs/devcenter/*.md`，构建时打包进前端（文件名即线上地址 `/dev/<文件名>`，不要改名）

## 常用命令

```bash
./scripts/selftest.sh                  # 全流程自测（改 yh、平台接口、SDK、模板后必跑）
./scripts/selftest.sh --keep           # 保留自测环境用浏览器体验（http://localhost:18080），之后 --clean 清理
./scripts/upgrade-test.sh              # 平台升级自测（改 yh 的升级部分、scripts/pack.sh 后必跑；不需要 Docker）
./scripts/tunnel-test.sh               # 隧道配置自测（改 yh 的 render_frpc / EXTRA_TUNNELS / APPS_URL / doctor 隧道检查后必跑；不需要 Docker）
./scripts/health-test.sh               # 公网入口巡检自测（改 yh 的 public_watch / notify 或 cloud/healthcheck.sh 后必跑；不需要 Docker）
cd console/backend && npm test         # 单元测试（node:test，不需要数据库）
cd console/backend && NODE_ENV=test node --test test/market.test.js                 # 跑单个测试文件
cd console/backend && NODE_ENV=test node --test --test-name-pattern='关键词' test/*.test.js  # 按名字跑
cd console/frontend && npm run build   # 前端没有测试和 lint，至少确认能构建
# 本地开发控制台：起一个 MySQL，改 .env，然后
cd console/backend && cp .env.example .env && npx prisma migrate deploy && npm run dev
cd console/frontend && npm i && npm run dev
```

- 给新公司装平台走 `install.sh --company …`（公司安装 = 更新包方式：从 Git 检出 `git archive` 导出，没有 `.git`，不跟踪 `release`），云端走 `cloud/install.sh`；部署工程师的完整流程在 `docs/部署手册.md`。改了这两个脚本，至少在本机跑一遍 `./install.sh --test --demo` 和一次 `--company … --dir <临时目录> --no-autostart --yes`（用完 `./yh destroy`）
- `selftest.sh` 需要 Docker（macOS 用 colima），会在 `$TMPDIR/yh-selftest` 复制一份平台跑测试模式，占用容器名 `yh-*`、网络 `yh-net`、端口 18080。**本机已有 `yh-*` 容器（即正式部署了平台的机器）会拒绝运行**
- 改 `schema.prisma` 后：`npx prisma migrate dev --name <名称>`（需要开发库），迁移文件要提交

## 架构要点（跨文件才看得出来的部分）

- **请求路径**：`yh-caddy` 把 `/apps/<code>/*` 剥掉前缀转给容器 `yh-<code>`（带 `X-Forwarded-Prefix`），其余都转给 `yh-console:3105`。配了 `APPS_URL`（应用独立域名）时应用路由只挂在应用域名的站点上（`<code>.app`，否则是 `<code>.caddy`），前缀仍是 `/apps/<code>`（各应用自带的 SDK 只认这个形状）；`yh` 里取应用地址、发健康检查一律用 `app_url` / `app_http`，不要手拼 `/apps/`。后端按前缀挂路由（`src/index.js`）：`/api/auth` `/api/sso` `/api/open`（应用凭证）`/api/platform`（`PLATFORM_TOKEN`，只给 `yh` 用）`/api/setup` 是公开的，其余经过 `authenticate()`，由它生成 `req.ctx`。`/api/mcp` 自己解析 body，必须挂在 `express.json` 之前。生产环境下后端用 `STATIC_DIR` 直接托管前端构建产物
- **分层**：`routes/`（薄）→ `services/`（权限 + 业务 + `audit`）→ `lib/prisma.js`。登录方式适配在 `lib/{dingtalk,feishu,wecom}.js`，加密在 `lib/secret.js`
- **统一认证两种入口，同一套底子**：平台 SDK 走 `/api/sso/*`（套 `{ code, data }`）；现成系统走标准 OIDC（`services/oidc.js`、`routes/oidc.js`、`/.well-known/openid-configuration`，按 OAuth2 规范返回，id_token 用 RS256，私钥加密存在 `SystemSetting.oidcSigningKey`）。两者共用应用登记、`checkRedirect`、`visibleTo`、授权确认和 `apps.redeemCode`；OIDC 字段同样按 `scopesOf` 收敛。`/api/oidc/*` 和 `/api/open/llm/*` 是对外协议边界，不套 `{ code, data }`
- **资料中心**（`services/assets.js`）：文件按 sha256 存在 `AssetBlob`（MySQL，和知识库一样），版本是一整套文件；下载只走签名地址 `/api/asset-files/:id`（不要另开下载口），响应必须带 CSP sandbox + nosniff（上传的 SVG / HTML 是不可信内容，和控制台同域）
- **空间（多公司 / 客户隔离）**：可见性只在 `services/spaces.js`（`appInSpace` / `spaceWhere`）+ `apps.visibleTo` 判断；新写「查人 / 查部门 / 列应用」的地方都要按它收敛（普通人只看自己空间，管理员跨空间）。新建的人 / 部门 / 应用 / 知识库要带上 `spaceId`，见 `docs/设计-多空间.md`
- **Skill 是第五种 `App.kind`（`SKILL`）**：内容（文件 base64 + `digest`）在 `AppVersion.payload`，校验在 `services/skills.js` 的 `normalizeSkillPayload`（不可信输入），版本 / 审核 / 可见范围全走 studio 与 `visibleTo`。Skill 不是能「打开」的应用：工作台用 `apps.USABLE`（不含 Skill），应用市场用 `apps.MARKET_LISTABLE`（含 Skill）
- **AI 能力一处登记，两处生效**：`src/tools/index.js` 的 `TOOLS` 同时给内置助手（`agent/runner.js`，模型适配在 `agent/llm.js`）和 MCP Server（`mcp/index.js`）用；应用自带的 MCP 工具由 `agent/appTools.js` 按 `visibleTo` 合并进来，以当前用户身份转发
- **控制台 ↔ 宿主机**：控制台只写 `PlatformOp`；`yh agent` 每 4 秒领一条，在子 shell 里执行，交回日志；每 30 秒上报应用状态和平台版本（`report_platform` → `POST /api/platform/info` → `services/upgrade.js`）
- **配置分两层**：启动必需的放 `yh.env`，由 `yh` 生成 `platform/console.env` 给控制台容器；其余放 `SystemSetting`（`services/settings.js` 的 `SCHEMA`），即改即生效
- **应用**：`yh new <code> --from node|python` 从 `templates/` 生成，运行目录是 `apps/<code>/`（源码在 `src/`，Caddy 片段在 `platform/caddy/apps/<code>.caddy`）。应用自己的 `src/CLAUDE.md` 管应用内的开发约定

## 约定（改代码前必读）

1. **控制台只做配置**。业务功能（审批、考勤……）一律做成应用，不要加进控制台
2. **身份上下文**：业务函数第一个参数是 `ctx = { user, via, ip }`，`via` 取值 WEB / AI / MCP / APP / SYSTEM
3. **权限写在业务层**（`src/services/`），路由保持薄：`wrap(req => svc.fn(req.ctx, ...))`
4. **新增一个控制台 AI 能力 = 在 `src/tools/index.js` 登记一个工具**，内置助手和 MCP 自动获得；写操作设 `write: true, confirm: true`
5. **写操作要留痕**：`audit(ctx, 'domain.action', { entityType, entityId, detail })`
6. 响应统一 `{ code: 0, data }`，错误抛 `badRequest / forbidden / notFound`（`src/lib/http.js`）
7. **功能配置放系统设置，不要加新的环境变量**：在 `src/services/settings.js` 的 `SCHEMA` 里加字段（前端自动渲染）
8. **控制台不碰 Docker**：宿主机上的动作走 `PlatformOp` 队列，由 `yh agent` 执行（`services/platform.js` ↔ `yh` 的 `run_op`）
9. SDK 以 `console/frontend/public/sdk/` 为准，改了同步复制到 `templates/node/`、`templates/python/`（自测会校验）
10. 接入相关的变动同步更新开发中心文档，并在 `console/docs/devcenter/changelog.md` 记一笔
11. `yh` 里会退出的函数（`die`）在 agent / 自动发布里都要放进子 shell 调用，不然会带走常驻进程
12. **应用市场**：「谁能看到 / 能用」一律走 `services/apps.js` 的 `visibleTo`，不要另写判断；版本生效只走 `studio.publishVersion`
13. **轻应用是不可信代码**：`LiteFrame.vue` 的 sandbox 属性和 CSP 不能放宽；给 `window.yh` 加能力 = 在 LiteFrame 的 `HANDLERS` 白名单和 `services/lite.js` 各加一处，并在 `codegen.js` 的 `SDK_DOC` 和开发中心 `lite.md` 里写清楚
14. 员工发布的应用拿到的用户信息按授权范围收敛（`apps.js` 的 `userInfo`），新增用户字段时想清楚归到哪个 scope
15. **部署方式是隧道转发模式**（真实服务跑本机，公网服务器只做 TLS + frp 转发）：只在 `main` 开发，`release` 只由 `./release.sh` 更新；生产目录就是本仓库，**不要在生产目录手工改源码**（会让平台自更新失败）。改部署方式前先读 `docs/发布方式.md`
16. **平台自身的版本与升级**：版本号 x.y.z（语义化版本，0.x = Beta，见 `docs/版本管理.md`）在根目录 `VERSION`，**只用 `scripts/bump-version.sh` 改**；更新包必须签名（私钥 `~/.yihu-one-release.key` 在发布机，公钥 `platform/release.pub` 和 `install.sh` 的 `RELEASE_PUB` 要一致，换密钥两处一起改）（同时改控制台 package.json，单元测试校验一致；更新说明写在 `console/docs/devcenter/releases.md`），发版用 `scripts/pack.sh`（见部署手册「平台升级」）。控制台要知道宿主机上的事（版本、最新版本）由 `yh` 上报（`report_platform` → `services/upgrade.js`），不要给控制台加环境变量或让它自己联网；升级动作只走 `PlatformOp(UPGRADE)`
17. **外观只用设计令牌**：颜色、圆角、阴影、字体一律用 `styles/main.css` 里的 `--yh-*` 变量，不要写死（`#fff`、蓝色、渐变都不行）——每家公司、每个空间的 VI 不同，由 `services/theme.js`（预设 + 改过的项）→ 前端 `utils/theme.js` 的 `deriveVars` 整组换掉。加令牌两边一起改，`main.css` 里的默认值用 `deriveVars` 对以虎 VI 重新生成
