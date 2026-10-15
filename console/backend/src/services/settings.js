// 系统设置: 控制台的功能配置在后台改, 即时生效, 不用改 .env 重启
// 取值优先级: 后台保存的值 > 环境变量 > 默认值
// 仍然只在环境变量里的: DATABASE_URL / PORT / JWT_SECRET / SECRET_KEY / PLATFORM_TOKEN / DEV_LOGIN / NODE_ENV
//   —— 要么启动前就得有, 要么是安全底线(开发登录放后台, 一个误操作就能让任何人冒充任何人)
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/http.js'
import { encryptJson, decryptJson } from '../lib/secret.js'
import * as theme from './theme.js'

/**
 * 设置项定义。type: text / url / password(加密存储) / bool / number / list(字符串数组) / textarea / image(图片, data URL 或图片地址) / color(#RRGGBB 颜色) / theme(整套 VI, 见 services/theme.js)
 * hidden: 不在后台显示(兼容老版本留着的项)
 * 分组的 page 决定显示在哪个管理页: settings 系统设置 / login 登录方式
 */
export const SCHEMA = {
  general: {
    label: '基本信息',
    page: 'settings',
    fields: {
      workspaceName: { label: '平台名称', type: 'text', default: '以虎 One', help: '登录页、浏览器标题、侧边栏显示' },
      workspaceSubtitle: { label: '平台英文名', type: 'text', default: 'YIHU ONE', help: '侧边栏平台名称下面那行小字，留空则不显示' },
      logo: { label: 'LOGO', type: 'image', default: '', help: '侧边栏、登录页、授权页、开发中心和浏览器标签页图标都用它；建议正方形 PNG / SVG，不超过 200KB。不设置用「外观与主题」里预设自带的 LOGO（以虎科技 VI 是以虎标志），预设没有 LOGO 时显示平台名称的第一个字' },
      companyName: { label: '组织名称', type: 'text', default: '', help: 'AI 助手的系统提示里会用到' },
      publicBaseUrl: { label: '访问地址', type: 'url', env: 'PUBLIC_URL', default: 'http://localhost:18080', help: '用户浏览器里打开的地址；钉钉回调、应用地址都基于它。yh init 时已写好，换域名后同步修改' },
      devCenterPublic: { label: '开发中心免登录访问', type: 'bool', default: true, help: '关掉后需要登录才能看开发文档' },
      timezone: { label: '时区', type: 'text', default: 'Asia/Shanghai', help: '定时任务（如每天 8 点的经营简报）按这个时区算时间，IANA 写法，如 Asia/Shanghai、Asia/Singapore' }
    }
  },
  appearance: {
    label: '外观与主题',
    page: 'settings',
    fields: {
      theme: { label: '视觉识别（VI）', type: 'theme', default: null, help: '选一套预设，再按公司 VI 改颜色、字体、圆角；改动保存后立即生效。没上传 LOGO 时用预设自带的 LOGO。多空间时每个空间还可以在「空间」里设置自己的 VI' },
      // 0.1 之前只有一个主色: 老平台改过主色的, 没设 VI 前按「经典蓝 + 这个主色」显示(theme.resolve)
      primaryColor: { label: '主题主色（旧）', type: 'color', default: '', hidden: true }
    }
  },
  notify: {
    label: '发布通知',
    page: 'settings',
    // 群机器人 webhook 在这里配; yh 经平台接口取配置自己发(平台升级中控制台重启也不丢通知)
    fields: {
      enabled: { label: '启用发布通知', type: 'bool', default: false, help: '平台升级 / 回滚、应用自动发布的结果发到下面配置的群机器人。保存后点「发测试消息」验证' },
      feishuWebhook: { label: '飞书机器人 Webhook', type: 'password', default: '', help: '飞书群 → 设置 → 群机器人 → 添加「自定义机器人」。安全设置建议选「自定义关键词」填「发布」（通知落款自带「发布」二字）。可选' },
      dingtalkWebhook: { label: '钉钉机器人 Webhook', type: 'password', default: '', help: '钉钉群 → 群设置 → 智能群助手 → 添加「自定义机器人」。可选' },
      dingtalkSecret: { label: '钉钉加签密钥', type: 'password', default: '', help: '机器人安全设置选了「加签」才填（SEC 开头）；用关键词「发布」则留空' },
      wecomWebhook: { label: '企业微信机器人 Webhook', type: 'password', default: '', help: '企业微信群 → 群设置 → 添加群机器人。可选' }
    }
  },
  login: {
    label: '登录方式',
    page: 'login',
    fields: {
      password: { label: '账号密码登录', type: 'bool', default: true, help: '用户用「管理 → 用户」里设置的账号和密码登录。关掉前先确认钉钉登录可用，否则所有人都进不来' },
      dingtalk: { label: '钉钉登录', type: 'bool', default: false, help: '扫码登录 + 钉钉客户端内免登。需要先在下面填好钉钉应用凭证' },
      feishu: { label: '飞书登录', type: 'bool', default: false, help: '网页授权登录 + 飞书客户端内免登。需要先在下面填好飞书应用凭证' },
      wecom: { label: '企业微信登录', type: 'bool', default: false, help: '扫码登录 + 企业微信客户端内免登。需要先在下面填好企业微信应用凭证' },
      autoCreateUser: { label: '首次登录自动建号', type: 'bool', default: true, help: '钉钉 / 飞书 / 企业微信里的人第一次登录时自动创建用户（手机号或邮箱和已有用户一致时直接对上）；关掉后只有管理员建过（或同步过）的人能登录' },
      sessionDays: { label: '登录有效期（天）', type: 'number', default: 7, min: 1, max: 90 }
    }
  },
  dingtalk: {
    label: '钉钉应用',
    page: 'login',
    // 字段名与钉钉开发者后台「应用 → 凭证与基础信息」一致; 该页的 App ID 不需要
    fields: {
      clientId: { label: 'Client ID（原 AppKey）', type: 'text', env: 'DINGTALK_CLIENT_ID', default: '', help: '钉钉开发者后台 → 应用 → 凭证与基础信息，形如 ding8f6x…；同页的「App ID」不需要填。要开的权限（通讯录个人信息读权限、成员信息读权限等）见开发中心 /dev/login-setup' },
      clientSecret: { label: 'Client Secret（原 AppSecret）', type: 'password', env: 'DINGTALK_CLIENT_SECRET', default: '', help: '同一页，点「查看」拿到完整值' },
      corpId: { label: 'CorpId（企业 ID）', type: 'text', env: 'DINGTALK_CORP_ID', default: '', help: '开发者后台首页右上角或「企业信息」里，ding 开头；钉钉内免登用' },
      agentId: { label: 'AgentId（发工作通知用）', type: 'text', default: '', help: '开发者后台 → 应用 → 凭证与基础信息里的 AgentId。填了之后，应用可以经平台给个人发钉钉工作通知（如 FDE 的任务指派、工时审批）；不填则不发' },
      bootstrapAdmins: { label: '钉钉管理员（userid）', type: 'list', default: [], help: '这些人钉钉登录后自动成为管理员。userid 在钉钉管理后台 → 通讯录 → 成员详情里' }
    }
  },
  market: {
    label: '应用市场',
    page: 'market',
    fields: {
      publishEnabled: { label: '允许员工发布应用', type: 'bool', default: true, help: '关掉后只有管理员能在创作中心建应用' },
      agentsPerUser: { label: '每人最多 AI 助手数', type: 'number', default: 20, min: 1, max: 500 },
      litesPerUser: { label: '每人最多轻应用数', type: 'number', default: 20, min: 1, max: 500 },
      skillsPerUser: { label: '每人最多 Skill 数', type: 'number', default: 50, min: 1, max: 1000 },
      hostedPerDeveloper: { label: '每个开发者最多代码应用数', type: 'number', default: 3, min: 0, max: 100, help: '只限开发者角色；管理员不受限' },
      liteRowsPerApp: { label: '轻应用每个最多数据条数', type: 'number', default: 20000, min: 100, max: 1000000 },
      liteAiPerDay: { label: '轻应用 AI 调用（每人每天）', type: 'number', default: 50, min: 0, max: 10000, help: '轻应用里 yh.ai.ask 的次数，所有轻应用合计' },
      codegenModel: { label: '生成轻应用用的模型', type: 'text', default: '', help: '填「模型与 AI」里某个模型的名称；留空用默认模型。建议选写代码强的模型' }
    }
  },
  feishu: {
    label: '飞书应用',
    page: 'login',
    // 飞书开放平台 → 开发者后台 → 企业自建应用 → 凭证与基础信息
    fields: {
      appId: { label: 'App ID', type: 'text', default: '', help: '飞书开发者后台 → 企业自建应用 → 凭证与基础信息，cli_ 开头。应用要开启「网页应用」能力，「安全设置 → 重定向 URL」里加上 <访问地址>/auth/feishu/callback。**应用的「可用范围」要包含使用的人**：应用发布 → 版本管理与发布 → 可用范围选全员（或对应部门），不发布/范围没人时，其他人授权会被飞书拦下提示没有使用权限；临时验证可把人加为应用测试人员' },
      appSecret: { label: 'App Secret', type: 'password', default: '', help: '同一页。权限管理里至少开通「获取用户基本信息」；要自动对上已有用户，再开通「获取用户手机号 / 邮箱」；要从飞书同步部门与人员，再开通通讯录权限并把通讯录权限范围设为全部成员。逐项清单见开发中心 /dev/login-setup' },
      bootstrapAdmins: { label: '飞书管理员（open_id 或手机号）', type: 'list', default: [], help: '这些人用飞书登录后自动成为管理员。优先填 open_id（ou_ 开头），不要填 union_id（on_ 开头）或 user_id——填错不会生效也不报错；也可以直接填手机号。open_id 在飞书开发者后台「API 调试台」选当前应用查询自己获得，或从飞书同步用户后在「用户与部门」里把鼠标悬停在飞书标签上看' }
    }
  },
  wecom: {
    label: '企业微信应用',
    page: 'login',
    // 企业微信管理后台 → 应用管理 → 自建应用
    fields: {
      corpId: { label: 'CorpID（企业 ID）', type: 'text', default: '', help: '企业微信管理后台 → 我的企业 → 企业信息，页面最下方的「企业ID」' },
      agentId: { label: 'AgentId', type: 'text', default: '', help: '应用管理 → 自建应用 → 你的应用，页面上的 AgentId' },
      secret: { label: 'Secret', type: 'password', default: '', help: '同一页点「查看」。还要在应用里设置「网页授权及 JS-SDK」的可信域名、「企业微信授权登录」的授权回调域（都填访问地址的域名）和「企业可信 IP」（平台机器的出口 IP）。见开发中心 /dev/login-setup' },
      bootstrapAdmins: { label: '企业微信管理员（userid 或手机号）', type: 'list', default: [], help: '这些人用企业微信登录后自动成为管理员。userid 在管理后台 → 通讯录 → 成员详情里（「账号」）' },
      // 可信域名要求 https://<域名>/WW_verify_xxx.txt 能访问到企业微信给的验证文件：填在这里，平台直接在根路径返回
      verifyFileName: { label: '可信域名验证文件名', type: 'text', default: '', help: '配置「网页授权及 JS-SDK → 可信域名」时企业微信要求下载的验证文件名，形如 WW_verify_abc123.txt。填上文件名和内容，保存后 https://<域名>/<文件名> 就能访问到，回企业微信点「验证」即可。完整配置见开发中心 /dev/login-setup' },
      verifyFileContent: { label: '可信域名验证文件内容', type: 'text', default: '', help: '用文本编辑器打开下载的验证文件，把里面的一串字符原样粘贴过来' }
    }
  },
  llm: {
    label: '应用大模型',
    page: 'ai',
    fields: {
      dailyTokenLimit: { label: '每应用每日 token 配额（默认）', type: 'number', default: 0, min: 0, max: 100000000, help: '应用通过平台接口调用大模型的每日 token 上限默认值，0=不限；单个应用可在应用管理里单独覆盖' }
    }
  },
  assistant: {
    label: 'AI 助手',
    page: 'ai',
    fields: {
      enabled: { label: '启用 AI 助手', type: 'bool', default: true },
      allowModelSelect: { label: '允许用户选择模型', type: 'bool', default: true, help: '关掉后所有人都用默认模型' },
      assistantName: { label: '助手名称', type: 'text', default: 'AI 助手' },
      extraPrompt: { label: '补充规则', type: 'textarea', default: '', help: '追加到每个助手的系统提示里，如组织术语、特殊规定' },
      suggestions: { label: '快捷问题', type: 'list', default: ['我能用哪些应用？', '这些应用分别能帮我做什么？'] },
      maxRounds: { label: '单轮最多调用工具次数', type: 'number', default: 8, min: 1, max: 20 },
      tasksPerUser: { label: '每人最多定时任务数', type: 'number', default: 10, min: 0, max: 100, help: '定时 AI 任务（每日经营简报等）；0 = 关闭定时任务' },
      leaderHome: { label: '管理层默认用「管理层」首页', type: 'bool', default: true, help: '管理员和部门负责人没有自己改过首页时，默认首页是关键指标、待我决策、风险与动态、最新简报' }
    }
  }
}

const CACHE_MS = 10_000
// data URL 按 base64 算, 约等于 200KB 原图
const IMAGE_MAX = 280_000
let cache = null // { at, rows: Map }

async function rows() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows
  const list = await prisma.systemSetting.findMany()
  cache = { at: Date.now(), rows: new Map(list.map(r => [r.key, r])) }
  return cache.rows
}

function fromEnv(def) {
  const v = def.env ? process.env[def.env] : undefined
  if (v === undefined || v === '') return undefined
  if (def.type === 'bool') return v !== 'false'
  if (def.type === 'number') return Number(v)
  if (def.type === 'list') return v.split(',').map(s => s.trim()).filter(Boolean)
  return v
}

/** 取一组设置的实际生效值(含密码明文, 仅供服务端使用) */
export async function get(group) {
  const g = SCHEMA[group]
  if (!g) throw new Error(`未知设置组 ${group}`)
  const row = (await rows()).get(group)
  const saved = row?.value || {}
  let secrets = {}
  try { secrets = row?.secretEnc ? decryptJson(row.secretEnc) : {} } catch { secrets = {} }
  const out = {}
  for (const [k, def] of Object.entries(g.fields)) {
    const stored = def.type === 'password' ? secrets[k] : saved[k]
    out[k] = stored !== undefined && stored !== null && stored !== '' ? stored : (fromEnv(def) ?? def.default)
  }
  return out
}

// ---------- 管理 ----------

/** 给后台看: 每项的定义、当前值(密码打码)、来源 */
export async function listForAdmin(ctx, page) {
  assertAdmin(ctx)
  const all = await rows()
  const out = []
  for (const [key, g] of Object.entries(SCHEMA)) {
    if (page && g.page !== page) continue
    const row = all.get(key)
    const saved = row?.value || {}
    let secrets = {}
    try { secrets = row?.secretEnc ? decryptJson(row.secretEnc) : {} } catch { secrets = {} }
    const effective = await get(key)
    out.push({
      key, label: g.label, page: g.page, updatedAt: row?.updatedAt || null,
      fields: Object.entries(g.fields).filter(([, def]) => !def.hidden).map(([k, def]) => {
        const stored = def.type === 'password' ? secrets[k] : saved[k]
        const source = stored !== undefined && stored !== null && stored !== '' ? 'db' : fromEnv(def) !== undefined ? 'env' : 'default'
        return {
          key: k, label: def.label, type: def.type, help: def.help || null, env: def.env || null,
          min: def.min, max: def.max,
          ...(def.type === 'theme' ? { catalog: theme.catalog(), resolved: theme.resolve(effective[k], effective.primaryColor) } : {}),
          value: def.type === 'password' ? (effective[k] ? '******' : '') : effective[k],
          source
        }
      })
    })
  }
  return out
}

function coerce(def, v, label) {
  switch (def.type) {
    case 'bool': return !!v
    case 'number': {
      const n = Number(v)
      if (Number.isNaN(n)) throw badRequest(`「${label}」必须是数字`)
      if (def.min !== undefined && n < def.min) throw badRequest(`「${label}」不能小于 ${def.min}`)
      if (def.max !== undefined && n > def.max) throw badRequest(`「${label}」不能大于 ${def.max}`)
      return n
    }
    case 'list':
      if (!Array.isArray(v)) throw badRequest(`「${label}」必须是列表`)
      return v.map(s => String(s).trim()).filter(Boolean)
    case 'image': {
      const v2 = String(v || '').trim()
      if (!v2) return ''
      if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v2) && !/^https?:\/\/\S+$/.test(v2)) throw badRequest(`「${label}」须为 PNG / JPG / GIF / WebP / SVG 图片`)
      if (v2.length > IMAGE_MAX) throw badRequest(`「${label}」图片太大，请压缩到 200KB 以内`)
      return v2
    }
    case 'color': {
      const v2 = String(v || '').trim()
      if (!v2) return ''
      if (!/^#[0-9a-fA-F]{6}$/.test(v2)) throw badRequest(`「${label}」须为 #RRGGBB 格式的颜色`)
      return v2.toLowerCase()
    }
    case 'theme':
      try { return theme.normalize(v) } catch (e) { throw badRequest(e.message) }
    case 'url':
      if (v) { try { new URL(v) } catch { throw badRequest(`「${label}」不是有效地址`) } }
      return String(v || '').replace(/\/$/, '')
    default:
      return String(v ?? '')
  }
}

/**
 * 修改一组设置(只传要改的项)。密码项传空串 = 不修改, 传 null = 清除;
 * 其他项传 null = 恢复为环境变量 / 默认值
 */
export async function update(ctx, group, body) {
  assertAdmin(ctx)
  const g = SCHEMA[group]
  if (!g) throw notFound(`未知设置组 ${group}`)
  const existing = await prisma.systemSetting.findUnique({ where: { key: group } })
  const value = { ...(existing?.value || {}) }
  let secrets = {}
  try { secrets = existing?.secretEnc ? decryptJson(existing.secretEnc) : {} } catch { secrets = {} }
  const changed = []
  for (const [k, v] of Object.entries(body || {})) {
    const def = g.fields[k]
    if (!def) throw badRequest(`「${g.label}」没有设置项 ${k}`)
    if (def.type === 'password') {
      if (v === '') continue
      if (v === null) delete secrets[k]
      else secrets[k] = String(v)
    } else if (v === null) {
      delete value[k]
    } else {
      value[k] = coerce(def, v, def.label)
    }
    changed.push(k)
  }
  await prisma.systemSetting.upsert({
    where: { key: group },
    create: { key: group, value, secretEnc: encryptJson(secrets), updatedBy: ctx.user.id },
    update: { value, secretEnc: encryptJson(secrets), updatedBy: ctx.user.id }
  })
  cache = null
  if (['login', 'dingtalk', 'feishu', 'wecom'].includes(group)) await guardLogin()
  // 密码不进审计
  audit(ctx, 'settings.update', {
    entityType: 'setting', entityId: group,
    detail: Object.fromEntries(changed.map(k => [k, g.fields[k].type === 'password' || g.fields[k].type === 'theme' ? '(已修改)' : g.fields[k].type === 'image' ? (value[k] ? '(已更换)' : '(已清除)') : value[k] ?? '(恢复默认)']))
  })
  return (await listForAdmin(ctx)).find(x => x.key === group)
}

/** 至少留一种能用的登录方式, 否则所有人(包括管理员)都进不来 */
async function guardLogin() {
  const [login, ding, fs, wc] = await Promise.all([get('login'), get('dingtalk'), get('feishu'), get('wecom')])
  if (login.password) return
  if (login.dingtalk && ding.clientId && ding.clientSecret) return
  if (login.feishu && fs.appId && fs.appSecret) return
  if (login.wecom && wc.corpId && wc.agentId && wc.secret) return
  await prisma.systemSetting.update({ where: { key: 'login' }, data: { value: { ...(await prisma.systemSetting.findUnique({ where: { key: 'login' } })).value, password: true } } })
  cache = null
  throw badRequest('至少要保留一种可用的登录方式：钉钉 / 飞书 / 企业微信都没有配好并打开时，不能关闭账号密码登录')
}

/** 企业微信可信域名验证文件：文件名对得上才返回内容（只认 WW_verify_*.txt），否则 null */
export async function domainVerifyFile(name) {
  if (!VERIFY_NAME.test(name || '')) return null
  return matchVerifyFile(name, await get('wecom'))
}
const VERIFY_NAME = /^WW_verify_[A-Za-z0-9]{1,64}\.txt$/
/** 纯函数，便于测试：w = 企业微信设置组 */
export function matchVerifyFile(name, w) {
  if (!VERIFY_NAME.test(name || '')) return null
  const content = String(w?.verifyFileContent || '').trim()
  return String(w?.verifyFileName || '').trim() === name && content && content.length <= 200 ? content : null
}

/** 前端启动时要的公开配置(不含任何密钥) */
export async function publicConfig() {
  const [general, assistant, login, appearance] = await Promise.all([get('general'), get('assistant'), get('login'), get('appearance')])
  return {
    workspaceName: general.workspaceName,
    workspaceSubtitle: general.workspaceSubtitle,
    logo: general.logo || '',
    companyName: general.companyName,
    passwordLogin: !!login.password,
    theme: theme.resolve(appearance.theme, appearance.primaryColor),
    features: { devCenterPublic: general.devCenterPublic, assistant: assistant.enabled, assistantName: assistant.assistantName }
  }
}
