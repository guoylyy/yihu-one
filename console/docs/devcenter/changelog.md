---
title: 变更记录
category: 参考
order: 61
summary: 开发中心与接入接口的变化
updated: 2026-10-13
---

# 变更记录

| 日期 | 变化 |
| --- | --- |
| 2026-10-13 | **AI 助手工具分流**：平台工具加上用户能看到的应用工具超过 60 个时，内置 AI 助手对工具多的应用改用 `find_app_tools` / `call_app_tool` 先查后调（模型一次能接的工具有上限，OpenAI 兼容接口一般 128 个），确认卡片和审计不变；MCP 接口照常返回全部工具。工具的 `description` 写上用户会说的关键词才查得到，只读工具记得标 `readOnlyHint: true`，见 [接入 AI 助手](/dev/mcp) |
| 2026-10-12 | 新增 [登录方式配置说明](/dev/login-setup)：钉钉、飞书、企业微信开发者后台要开的权限（含权限代码和对应接口）、回调地址、发布、验证和常见报错。企业微信的可信域名验证文件可以直接填在「登录方式 → 企业微信应用」里，平台在 `/<文件名>` 返回，不用动服务器 |
| 2026-10-11 | **版本号与 VI**：平台版本 `0.1.0`（Beta，语义化版本，见 [版本更新说明](/dev/releases)），`GET /api/me` 新增 `platform: { version, channel }`。控制台外观改为整套**视觉识别（VI）**：默认「以虎科技 VI」，管理员可按公司 VI 改颜色、字体、圆角、LOGO，每个空间可以有自己的 VI（`/api/me` 的 `brand`，`null` = 跟随平台）；`/api/auth/config` 的 `primaryColor` 换成 `theme: { preset, tokens }`。`get_brand_guidelines` 新增 `consoleTheme`，Agent 做页面时可以参考控制台当前的配色 |
| 2026-10-11 | **资料中心**：新增「资料」——公司的模板、品牌 VI、设计组件，带版本和责任人；品牌 VI 可以填结构化规范（颜色、字体、规则、口吻）。MCP 新增 `get_brand_guidelines` / `list_assets` / `get_asset` / `check_asset_updates`，Agent 能按公司规范做 PPT、页面；资料更新后提示用过旧版本的人。见 [资料中心](/dev/assets) |
| 2026-10-11 | **多空间**：一套平台可以开多个空间（多家公司 / 客户），不同空间的人互相看不到同事、部门、应用、Skill、知识库。统一登录和 OIDC 新增用户所在空间（`space`），用户主数据只给应用所在空间的人。**应用分享给多个空间时，要按 `space` 分开自己的数据**（轻应用平台自动分开）。单空间的平台没有变化。见 [统一认证](/dev/sso)、[用户主数据](/dev/users) |
| 2026-10-10 | **千人千面首页**：每个人一份自己的首页（默认就是原来的工作台），可以在网页上增删、排序、隐藏卡片，也可以让自己的 Agent 用 MCP 的 `get_my_home` / `set_my_home` 改。新增**数据卡片**：以本人身份调应用的只读 MCP 工具，显示成数字 / 列表 / 表格 / 折线——应用的只读工具设计得好，就能出现在同事的首页上，见 [接入 AI 助手 · 让工具能放到首页上](/dev/mcp) |
| 2026-10-10 | **应用独立域名**：平台可以把代码应用放到单独的域名（`<应用域名>/apps/<code>/`），和控制台不同源，应用页面里的脚本拿不到控制台的登录凭证。路径前缀不变，**应用不用改**（SDK、cookie 路径、相对地址照旧）；老地址自动跳转。应用地址以注入的 `YH_APP_URL` 为准，见 [应用部署规范](/dev/deploy) |
| 2026-10-10 | **用 Agent 发布**：MCP 新增 `list_my_published` / `check_app_code` / `publish_app` / `publish_status` / `set_app_visibility`，在自己的 Agent 里一句话发布轻应用、外部应用、代码应用（走创作中心同一套审核与安装流程），失败时返回人能看懂的原因；code 冲突给替代建议。创作中心新增「让 Agent 帮我发布」指令，个人中心显示每个 API Key 接入的是哪个 Agent，并给出 Claude Code 一条命令接入。见 [用 Agent 发布](/dev/agent-publish) |
| 2026-10-10 | **Skill 中心**：新增和应用并列的 Skill（含 `SKILL.md` 的文件夹，Claude Code、Codex 等通用格式）。创作中心上传 ZIP / 文件夹，或 Agent 通过 MCP 的 `publish_skill` 上传；发布范围和审核规则与应用一致，版本可回滚；应用市场新增 Skill 分类。新增 MCP 工具 `list_skills` / `get_skill` / `check_skill_updates` / `publish_skill`。见 [Skill 中心](/dev/skills)。另修复：已分享给指定同事的应用，改成上架全员后仍只有原来那些人能看到 |
| 2026-10-10 | **标准 OIDC**：平台成为标准 OpenID Connect 身份提供方（发现地址 `/.well-known/openid-configuration`，RS256 id_token、PKCE、`client_secret_basic` / `client_secret_post`）。GitLab、Grafana 等自带「通用 OIDC 登录」的现成系统登记后填几项配置就能统一登录，不用改代码；字段按应用的信息范围收敛。平台 SDK 的统一认证接口不变。见 [现成系统接入（标准 OIDC）](/dev/oidc) |
| 2026-10-03 | **应用大模型接口**：新增 OpenAI 兼容端点 `POST /api/open/llm/chat/completions`（流式、tools 都支持），应用用自己的凭证调用、继承平台模型配置，密钥不出平台；调用量在「使用数据 → AI 用量」按模型/应用/人统计，可设每应用每日 token 配额。JS/Python SDK 新增 `llm()`，见 [接入大模型](/dev/llm) |
| 2026-10-02 | **平台升级**：平台自身按版本号升级，管理员在「管理 → 概览」里看到新版本后一键升级（或上传更新包），升级前自动备份、失败自动回滚；升级期间各应用照常运行。应用 code 新增保留名 `platform`（已有保留名之外） |
| 2026-10-02 | **外观定制**：应用图标可以从内置图标库里选、上传图片（自动压到 128px）、填 emoji 或图片地址，并单独配色；系统设置新增「外观与主题」，改主色后全站即时换肤。应用清单 `yh-app.json` 新增可选字段 `iconColor`，`icon` 支持 `svg:<名称>` 写法，见 [应用部署规范](/dev/deploy) |
| 2026-10-02 | 首次安装改为**浏览器初始化向导**（设置管理员账号 + 站点信息，并预置一个通用 AI 助手）；新增 `install.sh` 一键安装脚本。生产 `yh init --url` 不再打印初始密码，无头安装可在 `yh.env` 里配 `ADMIN_INITIAL_PASSWORD` 兜底 |
| 2026-10-01 | 登录方式新增**飞书**和**企业微信**（网页 / 扫码登录 + 客户端内免登），可以和钉钉、账号密码同时打开。对接入应用透明：统一认证返回的仍是平台用户 |
| 2026-09-30 | **应用市场与创作中心**：员工可以做 AI 助手（提示词 + 工具）、用对话生成[轻应用](/dev/lite)、登记外部应用，开发者可以提交代码应用；仅自己 / 分享 / 上架市场三种范围，上架和代码应用要管理员审核。见 [创作中心](/dev/studio) |
| 2026-09-30 | 统一认证：员工发布的应用第一次登录要用户确认，只返回申请并同意的信息（`org` / `contact`），见 [统一认证](/dev/sso)。管理员安装的应用不受影响 |
| 2026-09-30 | 托管应用各自独立网络，应用之间不能直接访问；清单新增 `cpus`，默认 1 核 |
| 2026-09-28 | **以虎 One 首版**。平台跑起来默认就是控制台，只做配置（模型与 AI、登录方式、用户与部门、应用插拔），业务功能全部由应用提供 |
| 2026-09-28 | 命令行 `hf` → `yh`；清单 `hf-app.json` → `yh-app.json`（去掉 `basePath`、`core`，所有应用固定挂在 `/apps/<code>/`，不再有子域名）；环境变量 `HF_*` → `YH_*`；SDK 改名 [`/sdk/yh-one.mjs`](/sdk/yh-one.mjs)、[`/sdk/yh_one.py`](/sdk/yh_one.py)，会话 cookie `yh_sid`；个人 API Key 前缀 `yh_` |
| 2026-09-28 | 控制台里即可插拔应用：从 Git 安装、发布、重启、停用、移除、看日志，由宿主机上的 `yh agent` 执行；运行状态和发布记录在控制台可见 |
| 2026-09-28 | 统一认证返回的用户信息：新增 `username`、`email`；去掉 `positions`；`roles` 改为 ADMIN / MEMBER。开放接口 `/api/open/employees` → [`/api/open/users`](/dev/users) |
| 2026-09-28 | 平台 MCP（`/api/mcp`）聚合各应用的工具，外部智能体用个人 API Key 即可使用所有能看到的应用 |
| 2026-09-28 | 去掉审批、授权矩阵、事项中心、驾驶舱、外部系统连接器等业务功能；待办推送接口下线 |
