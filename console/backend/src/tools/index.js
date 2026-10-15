// AI 工具注册表 —— 控制台自带的「AI 能做的事」都在这里登记一次
// 控制台只做配置, 所以这里只有平台级的通用工具(我是谁、有哪些应用、找人);
// 具体业务能力来自插在平台上的应用: 应用声明 MCP 端点后, 它的工具自动并入每个人的助手(见 agent/appTools.js)
// 同一份定义同时供: ① 内置 AI 助手(function calling) ② MCP Server(给 OpenHex / Claude / Cursor 等外部智能体)
//
// 字段:
//   name / label(界面显示) / description(给模型看) / schema(zod raw shape)
//   write: 是否写操作;  confirm: 内置助手里是否需要用户点确认才执行
//   summarize(args, ctx): 确认卡片上给用户看的一句话
//   run(ctx, args): 执行, 返回可 JSON 序列化的结果
import { z } from 'zod'
import * as users from '../services/users.js'
import * as apps from '../services/apps.js'
import * as kb from '../services/kb.js'
import * as skills from '../services/skills.js'
import * as publishing from '../services/publishing.js'
import * as home from '../services/home.js'
import * as assets from '../services/assets.js'
import * as overview from '../services/overview.js'
import * as schedule from '../services/schedule.js'
import { spaceWhere } from '../services/spaces.js'
import { permissionsOf } from '../lib/auth.js'

export const TOOLS = [
  {
    name: 'get_my_profile',
    label: '查看我的身份',
    description: '获取当前用户的身份：姓名、账号、部门、角色、担任负责人的部门、系统权限。不确定用户是谁、能做什么时先调用。',
    schema: {},
    run: async (ctx) => {
      const u = ctx.user
      return {
        id: u.id, username: u.username, name: u.name, title: u.title, jobNumber: u.jobNumber,
        depts: u.depts, roles: u.roles, leaderOfDeptIds: u.leaderOf, permissions: permissionsOf(u)
      }
    }
  },
  {
    name: 'list_my_apps',
    label: '查看我的应用',
    description: '列出当前用户可以使用的应用（名称、说明、打开地址、是否已放在工作台、是否提供 AI 工具）。用户问「有哪些应用」「XX 在哪里」时使用。',
    schema: {},
    run: (ctx) => apps.listVisibleApps(ctx)
  },
  {
    name: 'search_users',
    label: '查找同事',
    description: '按姓名、账号、工号、职位或部门名查找用户，返回用户 id、部门、职位。应用工具需要用户 id 时用它把人名解析成 id。',
    schema: { keyword: z.string().describe('姓名/账号/工号/职位/部门关键词') },
    run: async (ctx, a) => {
      const r = await users.listUsers({ keyword: a.keyword, pageSize: 20, space: spaceWhere(ctx.user) })
      return { total: r.total, list: r.list.map(u => ({ id: u.id, name: u.name, username: u.username, title: u.title, jobNumber: u.jobNumber, depts: u.depts })) }
    }
  },
  {
    name: 'list_departments',
    label: '查看组织架构',
    description: '部门树，含每个部门的负责人和人数。',
    schema: {},
    run: (ctx) => users.departmentTree(spaceWhere(ctx.user))
  },
  {
    name: 'sync_org_contacts',
    label: '同步通讯录',
    description: '管理员把钉钉或飞书的通讯录（部门 + 人员）同步到「用户与部门」。会补齐缺失的部门和用户、更新已有用户的资料；不会删除或停用平台里已有的人。',
    schema: { provider: z.enum(['dingtalk', 'feishu']).describe('dingtalk=钉钉, feishu=飞书') },
    write: true,
    confirm: true,
    summarize: (a) => `从${a?.provider === 'feishu' ? '飞书' : '钉钉'}同步通讯录到用户与部门`,
    run: (ctx, a) => (a.provider === 'feishu' ? users.syncFromFeishu(ctx, {}) : users.syncFromDingtalk(ctx, {}))
  },
  {
    name: 'search_knowledge',
    label: '查企业知识库',
    description: '在企业知识库里检索财务、考勤、业务制度等已上传的知识，返回最相关的片段和出处（来自哪个文档、哪个知识库）。回答涉及公司规定/制度/标准/流程类问题时优先使用；拿到结果后用它作答并注明来源文档。只搜得到管理员开放给你所在范围的知识库。',
    schema: {
      query: z.string().describe('要查的问题或关键词，如「差旅费报销标准是什么」'),
      topK: z.number().min(1).max(10).optional().describe('返回片段数，默认 5')
    },
    run: async (ctx, a) => {
      const list = await kb.searchKnowledge(ctx.user, a.query, { topK: a.topK || 5 })
      return {
        total: list.length,
        results: list.map(r => ({
          kb: r.kbName, document: r.docName, score: Number(r.score.toFixed(4)), content: r.content,
          documentId: r.documentId, kbId: r.kbId
        }))
      }
    }
  },
  // ---------- Agent 原生发布：在用户自己的 Agent 里一句话发应用（走创作中心同一套流程，审核规则不变） ----------
  {
    name: 'list_my_published',
    label: '我发布的应用',
    description: '当前用户能发布哪些类型（canPublish）、发布规则，以及他已经发布的应用和 Skill：id、类型、发布范围、是否已生效、访问地址。发布前先调用，判断用户能发什么、是不是要更新已有的应用。',
    schema: {},
    run: (ctx) => publishing.myPublishing(ctx)
  },
  {
    name: 'check_app_code',
    label: '检查应用 code',
    description: '检查外部应用 / 代码应用的 code（英文唯一标识，决定访问地址 /apps/<code>/）能不能用；被占用或是保留字时给出可用的建议。新建 EXTERNAL / HOSTED 应用前调用。',
    schema: { code: z.string().describe('想用的 code，小写字母开头，只含小写字母、数字、短横线') },
    run: (ctx, a) => publishing.checkAppCode(ctx, a.code)
  },
  {
    name: 'publish_app',
    label: '发布应用',
    description: [
      '把用户本地的项目发布到平台（新建，或填 appId 给已有应用出新版本）。按项目选 kind：',
      'LITE 轻应用 = 单个 HTML 文件的小工具（跑在沙箱里不能联网；存数据、调 AI、调只读工具用 window.yh，见平台 /dev/lite），html 传完整文件；',
      'EXTERNAL 外部应用 = 已经部署在别处的系统，传 url（要统一登录再传 redirectUris，提供 AI 工具再传 mcpUrl）；',
      'HOSTED 代码应用 = 有 Dockerfile 和 yh-app.json 的服务，传已推送的 git 仓库地址，code 必须和 yh-app.json 一致，只有开发者能发、每次都要管理员审核。',
      '名称、简介、图标用户没说时，先根据项目给 2～3 个建议请用户选，不要自己定；EXTERNAL / HOSTED 的 code 先用 check_app_code 查。',
      '发布前必须问用户发给谁：PRIVATE 仅自己、SHARED 指定同事或部门（userIds / deptIds，用 search_users / list_departments 查）、MARKET 上架全公司（要审核）。',
      '发布后把返回的 url 和 result 告诉用户；代码应用用 publish_status 跟进安装进度。'
    ].join(''),
    schema: {
      kind: z.enum(['LITE', 'EXTERNAL', 'HOSTED']).optional().describe('新建时必填'),
      appId: z.number().optional().describe('更新已有应用时填（list_my_published 里的 id）'),
      name: z.string().max(60).optional(),
      description: z.string().max(200).optional().describe('一句话简介，上架市场时必填'),
      icon: z.string().max(500).optional().describe('emoji，如 🧾'),
      category: z.string().max(30).optional(),
      code: z.string().optional().describe('EXTERNAL / HOSTED 新建时必填'),
      html: z.string().max(400000).optional().describe('LITE：完整的 HTML 文件'),
      url: z.string().max(500).optional().describe('EXTERNAL：应用地址'),
      redirectUris: z.array(z.string().max(500)).max(10).optional().describe('EXTERNAL：统一登录回调地址'),
      mcpUrl: z.string().max(500).optional().describe('EXTERNAL：MCP 地址'),
      git: z.string().max(500).optional().describe('HOSTED：Git 仓库地址'),
      branch: z.string().max(100).optional().describe('HOSTED：分支，默认用 yh-app.json 的 deploy.branch'),
      userInfo: z.array(z.enum(['org', 'contact'])).optional().describe('EXTERNAL / HOSTED 统一登录要多拿的用户信息：org 部门职位工号、contact 手机邮箱'),
      scope: z.enum(['PRIVATE', 'SHARED', 'MARKET']).describe('发布范围'),
      userIds: z.array(z.number()).optional(),
      deptIds: z.array(z.number()).optional(),
      version: z.string().max(40).optional(),
      changelog: z.string().max(1000).optional()
    },
    write: true,
    confirm: true,
    summarize: (a) => {
      const scope = { PRIVATE: '仅自己可用', SHARED: '分享给指定同事 / 部门', MARKET: '上架全公司（需管理员审核）' }[a?.scope] || a?.scope
      const what = a?.appId ? `应用 #${a.appId} 的新版本` : `新${{ LITE: '轻应用', EXTERNAL: '外部应用', HOSTED: '代码应用' }[a?.kind] || '应用'}「${a?.name || ''}」`
      return `发布${what}，${scope}`
    },
    run: (ctx, a) => publishing.publishApp(ctx, a)
  },
  {
    name: 'publish_status',
    label: '查发布进度',
    description: '查一个自己发布的应用现在什么状态：是否生效、访问地址、是否在等审核或被打回（带原因）、代码应用的安装 / 发布进度。失败时 deployment.reason 是平台给的错误说明，用大白话转述给用户，不要贴整段日志。',
    schema: { appId: z.number().describe('应用 id') },
    run: (ctx, a) => publishing.publishStatus(ctx, a.appId)
  },
  {
    name: 'set_app_visibility',
    label: '修改发布范围',
    description: '修改自己发布的应用或 Skill 给谁用：PRIVATE 仅自己、SHARED 指定同事或部门、MARKET 上架全公司。审核规则和网页一样：要审核的范围在审核通过前仍按原范围。',
    schema: {
      appId: z.number(),
      scope: z.enum(['PRIVATE', 'SHARED', 'MARKET']),
      userIds: z.array(z.number()).optional(),
      deptIds: z.array(z.number()).optional()
    },
    write: true,
    confirm: true,
    summarize: (a) => `把应用 #${a?.appId} 的范围改成${{ PRIVATE: '仅自己', SHARED: '指定同事 / 部门', MARKET: '上架全公司（需审核）' }[a?.scope] || a?.scope}`,
    run: (ctx, a) => publishing.setVisibility(ctx, a)
  },
  // ---------- 千人千面首页：用户让自己的 Agent 改首页（只改他本人的，别人看不到） ----------
  {
    name: 'get_my_home',
    label: '查看我的首页',
    description: [
      '取当前用户的首页布局（cards，从上到下的顺序）和编辑目录：能放的应用（catalog.apps）、能用在数据卡片上的只读工具（catalog.tools）。改首页前先调用。',
      '卡片类型：greeting 问候 / setup 管理员开始配置 / assistant AI 助手输入框 / apps 我的应用 / app 单个应用入口 {appId} / link 外链 {title,url} / text 文字 {title,text}（纯文本）/ ',
      'data 数据卡片 {title, tool, args, view, x, y, field}：以用户本人身份调一个只读工具，view = auto 自动 | number 数字 | list 列表 | table 表格 | line 折线（x、y 填结果数组里对象的字段名）；结果是对象时用 field 指定取哪一层（如 data.list）。',
      '管理层用的卡片：metrics 关键指标 / decisions 待我决策 / events 风险与动态 / brief 最新经营简报（{title} 可选，数据来自各应用的标准工具，不用指定 tool）。',
      '每张卡片可以带 width: half（两张并排）、hidden: true。'
    ].join(''),
    schema: {},
    run: (ctx) => home.getHome(ctx)
  },
  {
    name: 'set_my_home',
    label: '修改我的首页',
    description: '保存当前用户的首页布局：cards 按从上到下的顺序给出全部卡片（会整份替换，没给的卡片就没了），格式见 get_my_home。数据卡片只能用 catalog.tools 里的工具，参数尽量带上筛选（只取前 10 条等），先自己调一次工具确认返回的结构再定 view 和 x / y。reset: true 恢复成默认首页。保存前把新首页的样子用一两句话告诉用户并得到同意。',
    schema: {
      cards: z.array(z.record(z.string(), z.any())).max(30).optional().describe('全部卡片，从上到下'),
      reset: z.boolean().optional().describe('true = 恢复默认首页')
    },
    write: true,
    confirm: true,
    summarize: (a) => (a?.reset ? '把首页恢复成默认的样子' : `把首页改成 ${a?.cards?.length || 0} 张卡片：${(a?.cards || []).map(c => c.title || c.type).join('、').slice(0, 80)}`),
    run: (ctx, a) => (a.reset ? home.resetHome(ctx) : home.saveHome(ctx, a.cards || []))
  },
  // ---------- 经营概览与定时任务：给老板的简报、老板助理、管理层首页（docs/设计-老板应用.md） ----------
  {
    name: 'get_business_overview',
    label: '查看经营概览',
    description: [
      '一次取全公司的经营概览：所有接入了经营数据的应用的关键指标（metrics）、变化与风险（events，level = risk / warn / info）、等当前用户拍板的事项（decisions）。',
      '用户问公司整体情况、今天要关注什么、有哪些风险、有什么事等他决定、要经营简报时先调它，再按需查具体应用的工具。',
      'apps 为空表示还没有应用提供经营数据；某个应用的 errors 不为空表示它这次没取到，如实告诉用户。'
    ].join(''),
    schema: {
      since: z.string().optional().describe('变化从什么时候算起，ISO 时间，默认 24 小时前'),
      period: z.enum(['today', 'week', 'month']).optional().describe('指标口径，默认 month')
    },
    run: (ctx, a) => overview.businessOverview(ctx, a)
  },
  {
    name: 'list_my_scheduled_tasks',
    label: '查看我的定时任务',
    description: '列出当前用户的定时 AI 任务（如每日经营简报）：名称、频率、下次运行时间、上次结果。',
    schema: {},
    run: (ctx) => schedule.list(ctx)
  },
  {
    name: 'create_daily_brief',
    label: '开通每日经营简报',
    description: '给当前用户开通每日经营简报：到点汇总各应用的关键指标、风险和待决策事项，推到他的钉钉 / 飞书 / 企业微信。已开通就改时间。开通后立即生成第一份。用户说「每天早上给我发简报」时用它。',
    schema: {
      kind: z.enum(['daily', 'weekdays']).optional().describe('daily 每天 / weekdays 工作日（默认）'),
      time: z.string().optional().describe('几点，HH:mm，默认 08:00')
    },
    write: true,
    confirm: true,
    summarize: (a) => `开通每日经营简报：${a?.kind === 'daily' ? '每天' : '工作日'} ${a?.time || '08:00'} 推到你的手机，现在先生成第一份`,
    run: (ctx, a) => schedule.createBrief(ctx, a || {})
  },
  {
    name: 'create_scheduled_task',
    label: '新建定时任务',
    description: '新建一个定时 AI 任务：到点以用户本人身份让 AI 助手做一件事（只能查、不能改数据），结果推到他的钉钉 / 飞书 / 企业微信，并存成对话。例如「每周五 17:00 总结本周项目进展」。每日经营简报用 create_daily_brief。',
    schema: {
      name: z.string().describe('任务名称，如「本周项目进展」'),
      prompt: z.string().describe('到点时让助手做什么，写完整，像对助手说话一样'),
      kind: z.enum(['daily', 'weekdays', 'weekly']).describe('每天 / 工作日 / 每周'),
      time: z.string().describe('几点，HH:mm'),
      weekday: z.number().optional().describe('每周的话星期几，1 = 周一 … 7 = 周日')
    },
    write: true,
    confirm: true,
    summarize: (a) => `新建定时任务「${a?.name}」：${schedule.describeSchedule({ kind: a?.kind, time: a?.time, weekday: a?.weekday })}，${String(a?.prompt || '').slice(0, 60)}`,
    run: (ctx, a) => schedule.create(ctx, { name: a.name, prompt: a.prompt, schedule: { kind: a.kind, time: a.time, weekday: a.weekday } })
  },
  // ---------- 资料中心：公司的模板、品牌 VI、设计组件（资料是素材，Skill 是做法） ----------
  {
    name: 'get_brand_guidelines',
    label: '取公司品牌规范',
    description: '取公司的品牌规范（颜色、字体、使用规则、文案口吻，以及 Logo 等文件）和可用的模板清单。用户要「按公司规范 / 用公司模板」做 PPT、页面、海报、文档时，先调用它，颜色和字体以返回的 spec 为准，不要自己编。',
    schema: {},
    run: (ctx) => assets.brandGuidelines(ctx)
  },
  {
    name: 'list_assets',
    label: '查看公司资料',
    description: '列出当前用户能用的公司资料：TEMPLATE 模板（PPT、文档）、BRAND 品牌 VI、COMPONENT 设计组件、OTHER 其他。返回 id、名称、简介、版本、责任人、用户上次用的版本（myVersion）。',
    schema: {
      category: z.enum(['TEMPLATE', 'BRAND', 'COMPONENT', 'OTHER']).optional(),
      keyword: z.string().optional()
    },
    run: (ctx, a) => assets.list(ctx, a)
  },
  {
    name: 'get_asset',
    label: '取用一份资料',
    description: '取一份资料的规范（spec）和全部文件：小的文本文件（SVG、CSS、JSON、Markdown）直接给 content，其他文件给 url（15 分钟内有效，直接下载，不用登录）。asset 填 list_assets 里的 id 或名称。会记下用户用的版本，之后有新版本可以提示。',
    schema: { asset: z.string().describe('资料 id 或名称') },
    run: (ctx, a) => assets.forAgent(ctx, a.asset)
  },
  {
    name: 'check_asset_updates',
    label: '检查资料更新',
    description: '看用户手上的资料是不是最新版：used 填 [{ id, version }]（get_asset 返回的）。只查询，有新版本时提示用户，同意后再 get_asset 取新的。',
    schema: { used: z.array(z.object({ id: z.number(), version: z.number() })).max(100) },
    run: (ctx, a) => assets.checkUpdates(ctx, a.used)
  },
  // ---------- Skill 中心：Agent 一句话取用 / 上传 Skill（Skill = 一个以 SKILL.md 为入口的文件夹，见开发中心 /dev/skills） ----------
  {
    name: 'list_skills',
    label: '查看可用的 Skill',
    description: '列出当前用户能用的 Skill（自己发布的、同事分享的、市场上架的）：id、name、简介、平台版本、内容指纹 digest、发布者。用户问「有哪些 Skill」「有没有做 XX 的 Skill」时使用。',
    schema: { keyword: z.string().optional().describe('按名称 / 简介 / 分类筛选，可不填') },
    run: (ctx, a) => skills.list(ctx, a)
  },
  {
    name: 'get_skill',
    label: '取用 Skill',
    description: '取一个 Skill 的全部文件（文本文件给原文，其他给 base64），用来安装到本地：把 files 按 path 原样写进本地 Skill 目录（如 ~/.claude/skills/<name>/），同名目录先备份或覆盖前问用户。skill 填 id 或 name。',
    schema: { skill: z.string().describe('Skill 的 id 或 name（list_skills 里的）') },
    run: (ctx, a) => skills.get(ctx, a.skill, { textAsUtf8: true })
  },
  {
    name: 'check_skill_updates',
    label: '检查 Skill 更新',
    description: '把本地装着的 Skill 和平台上的比一比，告诉用户哪些有新版本。installed 填本地每个 Skill 的 name，以及装的时候记下的 version 或 digest（get_skill 返回的）。只查询不修改；有更新时提示用户，用户同意后再用 get_skill 更新。',
    schema: {
      installed: z.array(z.object({
        name: z.string(),
        version: z.string().optional(),
        digest: z.string().optional()
      })).max(100).describe('本地的 Skill 列表')
    },
    run: (ctx, a) => skills.checkUpdates(ctx, a.installed)
  },
  {
    name: 'publish_skill',
    label: '发布 Skill',
    description: '把本地的一个 Skill 上传到平台，或修改已发布 Skill 的范围。files 是 Skill 文件夹里的全部文件（path 相对文件夹根目录，必须有 SKILL.md，开头 frontmatter 写 name 和 description）；同名的 Skill 你已经发过，会出一个新版本。发布前先问用户发给谁：PRIVATE 仅自己、SHARED 指定同事或部门（填 userIds / deptIds，用 search_users / list_departments 查 id）、MARKET 上架全公司（要管理员审核，审核通过前不生效）。只改范围时填 skillId、不带 files。',
    schema: {
      files: z.array(z.object({
        path: z.string().describe('相对 Skill 根目录的路径，如 SKILL.md、scripts/run.py'),
        content: z.string().describe('文件内容'),
        encoding: z.enum(['utf8', 'base64']).optional().describe('默认 utf8；图片等二进制文件用 base64')
      })).max(100).optional(),
      skillId: z.number().optional().describe('更新已有的 Skill 时填（list_skills 里的 id）'),
      scope: z.enum(['PRIVATE', 'SHARED', 'MARKET']).describe('发布范围'),
      userIds: z.array(z.number()).optional().describe('SHARED 时分享给哪些同事'),
      deptIds: z.array(z.number()).optional().describe('SHARED 时分享给哪些部门'),
      changelog: z.string().max(1000).optional().describe('这一版改了什么')
    },
    write: true,
    confirm: true,
    summarize: (a) => {
      const scope = { PRIVATE: '仅自己可用', SHARED: '分享给指定同事 / 部门', MARKET: '上架全公司（需管理员审核）' }[a?.scope] || a?.scope
      return a?.files ? `上传 Skill（${a.files.length} 个文件），${scope}` : `修改 Skill #${a?.skillId} 的发布范围：${scope}`
    },
    run: (ctx, a) => skills.publish(ctx, a)
  }
]

export const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]))

/** 按 schema 校验参数并执行 */
export async function runTool(ctx, name, args) {
  const tool = TOOL_MAP.get(name)
  if (!tool) throw new Error(`未知工具 ${name}`)
  const parsed = z.object(tool.schema).parse(args || {})
  return tool.run(ctx, parsed)
}

/** OpenAI function calling 格式 */
export function toOpenAiTools(list = TOOLS) {
  return list.map(t => {
    const schema = t.jsonSchema || z.toJSONSchema(z.object(t.schema))
    delete schema.$schema
    return { type: 'function', function: { name: t.name, description: t.description, parameters: schema } }
  })
}
