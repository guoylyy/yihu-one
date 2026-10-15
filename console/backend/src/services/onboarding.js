// 开通向导：装完以后管理员在浏览器里一步步把平台配好（docs/计划-0.5.0-本地部署开通.md）
// 每一步「配好没有」都按真实配置算（不是点了下一步就算），跳过的记在系统设置 onboarding 里；向导里改的和各管理页是同一份配置
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin, checkPasswordStrength } from '../lib/auth.js'
import { badRequest } from '../lib/http.js'
import * as settings from './settings.js'
import * as users from './users.js'
import * as platform from './platform.js'
import { BOSS_AGENT_CODE } from './setup.js'
import { sendToUsers } from './openApp.js'
import * as dingtalk from '../lib/dingtalk.js'
import * as feishu from '../lib/feishu.js'
import * as wecom from '../lib/wecom.js'

const KEY = 'onboarding'
export const STEPS = ['account', 'company', 'theme', 'models', 'login', 'people', 'notify', 'apps', 'finish']
const SKIPPABLE = new Set(['theme', 'models', 'login', 'people', 'notify', 'apps'])

/** 官方应用：开通向导里一键安装（走「从 Git 安装」同一套流程，由 yh agent 执行） */
export const OFFICIAL_APPS = [
  {
    code: 'fde', name: 'FDE 交付管理', icon: '🧭',
    description: '项目、里程碑、任务、工时与知识库；工程师和 AI 智能体一起交付。接入了老板的经营简报',
    git: 'https://github.com/guoylyy/yihu-fde.git', branch: 'release'
  }
]

async function state() {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } })
  return { skipped: [], ...(row?.value || {}) }
}
async function saveState(ctx, v) {
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: v, updatedBy: ctx.user.id }, update: { value: v, updatedBy: ctx.user.id } })
}
const hasRow = async (key) => !!(await prisma.systemSetting.findUnique({ where: { key } }))

/** 各步骤现在的情况（按真实配置算） */
export async function status(ctx) {
  assertAdmin(ctx)
  const [st, general, login, ding, fs, wc, notify, models, embModels, people, apps] = await Promise.all([
    state(), settings.get('general'), settings.get('login'), settings.get('dingtalk'), settings.get('feishu'), settings.get('wecom'), settings.get('notify'),
    prisma.llmConfig.count({ where: { deletedAt: null, enabled: true, kind: { not: 'EMBEDDING' } } }),
    prisma.llmConfig.count({ where: { deletedAt: null, enabled: true, kind: 'EMBEDDING' } }),
    prisma.user.count({ where: { deletedAt: null, active: true } }),
    prisma.app.count({ where: { deletedAt: null, status: 'ACTIVE', kind: { in: ['HOSTED', 'EXTERNAL'] } } })
  ])
  const base = String(general.publicBaseUrl || '').replace(/\/$/, '')
  const im = {
    dingtalk: !!(login.dingtalk && ding.clientId && ding.clientSecret),
    feishu: !!(login.feishu && fs.appId && fs.appSecret),
    wecom: !!(login.wecom && wc.corpId && wc.agentId && wc.secret)
  }
  const done = {
    account: true,
    company: !!general.companyName,
    theme: await hasRow('appearance'),
    models: models > 0,
    login: im.dingtalk || im.feishu || im.wecom || await hasRow('login'),
    people: people > 1,
    notify: !!(notify.enabled && (notify.feishuWebhook || notify.dingtalkWebhook || notify.wecomWebhook)) || !!(ding.agentId && im.dingtalk) || im.feishu || im.wecom,
    apps: apps > 0,
    finish: !!st.completedAt
  }
  const steps = STEPS.map(key => ({ key, done: done[key], skipped: st.skipped.includes(key), skippable: SKIPPABLE.has(key) }))
  const todo = steps.filter(s => s.key !== 'finish' && !s.done && !s.skipped).map(s => s.key)
  return {
    steps, todo, completedAt: st.completedAt || null,
    facts: {
      workspaceName: general.workspaceName, companyName: general.companyName, publicBaseUrl: base, timezone: general.timezone,
      models, embModels, people, apps, im, passwordLogin: !!login.password,
      callbacks: {
        dingtalk: `${base}/auth/dingtalk/callback`, feishu: `${base}/auth/feishu/callback`,
        wecomDomain: base.replace(/^https?:\/\//, '').replace(/[:/].*$/, ''), home: `${base}/`
      }
    }
  }
}

/** 跳过 / 取消跳过某一步 */
export async function skip(ctx, step, skipped = true) {
  assertAdmin(ctx)
  if (!SKIPPABLE.has(step)) throw badRequest('这一步不能跳过')
  const st = await state()
  st.skipped = skipped ? [...new Set([...st.skipped, step])] : st.skipped.filter(s => s !== step)
  await saveState(ctx, st)
  audit(ctx, 'onboarding.skip', { detail: { step, skipped } })
  return status(ctx)
}

/** 完成开通（之后首页不再弹向导，但「还有 X 项没配」照样提示） */
export async function complete(ctx) {
  assertAdmin(ctx)
  const st = await state()
  st.completedAt = new Date().toISOString()
  await saveState(ctx, st)
  audit(ctx, 'onboarding.complete', {})
  return status(ctx)
}

/** 登录方式「测试连接」：只读，返回每一项检查的结果 */
export async function testLogin(ctx, provider) {
  assertAdmin(ctx)
  const lib = { dingtalk, feishu, wecom }[provider]
  if (!lib) throw badRequest('provider 只能是 dingtalk / feishu / wecom')
  try {
    return await lib.testConnection()
  } catch (e) {
    return { ok: false, checks: [{ name: '连接', ok: false, message: e.message }] }
  }
}

/** 给自己发一条测试消息（钉钉工作通知 / 飞书 / 企业微信），看个人消息通不通 */
export async function messageMe(ctx) {
  assertAdmin(ctx)
  const rows = await prisma.user.findMany({ where: { id: ctx.user.id }, select: { id: true, dingUserId: true, feishuOpenId: true, wecomUserId: true } })
  const md = '这是开通向导发来的测试消息。收到了说明个人消息通了：每日经营简报、定时任务的结果都会这样推给你。'
  const r = await sendToUsers(rows, { title: '以虎 One 测试消息', markdown: md, plain: md, url: null })
  return r.sent.length ? { ok: true, message: `已发到你的${{ dingtalk: '钉钉', feishu: '飞书', wecom: '企业微信' }[r.sent[0].channel]}` } : { ok: false, message: r.skipped[0]?.reason || '没发出去' }
}

/** 应用这一步：老板助理、官方应用清单（装没装、安装进度）、yh agent 在不在线（不在线时安装会一直排队） */
export async function officialApps(ctx) {
  assertAdmin(ctx)
  const codes = OFFICIAL_APPS.map(a => a.code)
  const [installed, ops, plat, boss] = await Promise.all([
    prisma.app.findMany({ where: { code: { in: codes }, deletedAt: null }, select: { code: true, status: true } }),
    prisma.platformOp.findMany({ where: { kind: 'INSTALL', appCode: { in: codes } }, orderBy: { id: 'desc' }, take: 20 }),
    platform.overview(ctx),
    prisma.app.findFirst({ where: { code: BOSS_AGENT_CODE, deletedAt: null }, select: { id: true, name: true, status: true } })
  ])
  return {
    agent: plat.agent, boss,
    apps: OFFICIAL_APPS.map(a => {
      const app = installed.find(x => x.code === a.code)
      const op = ops.find(o => o.appCode === a.code)
      return { ...a, installed: !!app, status: app?.status || null, op: op ? { id: op.id, status: op.status } : null }
    })
  }
}

export async function installOfficial(ctx, code) {
  assertAdmin(ctx)
  const a = OFFICIAL_APPS.find(x => x.code === code)
  if (!a) throw badRequest('没有这个官方应用')
  return platform.requestOp(ctx, { kind: 'INSTALL', appCode: a.code, params: { git: a.git, branch: a.branch } })
}

// ---------------------------------------------------------------- 人员：表格导入

const yes = (v) => ['是', 'y', 'yes', 'true', '1', '√', '✓'].includes(String(v || '').trim().toLowerCase())
const COLS = { name: ['姓名', 'name'], username: ['账号', '用户名', 'username'], mobile: ['手机号', '手机', 'mobile'], email: ['邮箱', 'email'], dept: ['部门', 'department'], title: ['职位', 'title'], jobNumber: ['工号', 'jobnumber'], leader: ['部门负责人', '负责人', 'leader'], admin: ['管理员', 'admin'] }

/** 表格 → 规整的行（第一行是表头）。纯函数，便于测试 */
export function parseRows(table) {
  if (!Array.isArray(table) || table.length < 2) throw badRequest('表格至少要有表头和一行数据')
  if (table.length > 2001) throw badRequest('一次最多导入 2000 人')
  const head = table[0].map(h => String(h || '').trim().toLowerCase())
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex(h => names.includes(h))]))
  if (idx.name < 0) throw badRequest('表头里要有「姓名」列')
  return table.slice(1).map((r, i) => {
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '')
    const row = {
      line: i + 2, name: get('name'), username: get('username') || null, mobile: get('mobile').replace(/^\+86/, '') || null, email: get('email') || null,
      dept: get('dept').split(/[/／>＞]/).map(s => s.trim()).filter(Boolean), title: get('title') || null, jobNumber: get('jobNumber') || null,
      leader: yes(get('leader')), admin: yes(get('admin'))
    }
    row.error = !row.name ? '缺姓名' : row.username && !/^[a-zA-Z][a-zA-Z0-9_.-]{1,49}$/.test(row.username) ? '账号格式不对（字母开头，2~50 位）' : null
    return row
  }).filter(r => r.name || r.username || r.mobile)
}

/** 按「研发部/前端组」这样的路径找部门，没有就建 */
async function deptByPath(ctx, path, cache) {
  let parentId = null
  let id = null
  for (let i = 0; i < path.length; i++) {
    const key = path.slice(0, i + 1).join('/')
    if (cache.has(key)) { id = cache.get(key); parentId = id; continue }
    const found = await prisma.department.findFirst({ where: { name: path[i], parentId, deletedAt: null, spaceId: ctx.user.spaceId || 1 } })
    id = found ? found.id : (await users.createDepartment(ctx, { name: path[i], parentId })).id
    cache.set(key, id)
    parentId = id
  }
  return id
}

/**
 * 导入人员。dryRun 只预览（多少人、多少新部门、哪些行有问题）；password 是给有账号的人设的初始密码（可不填：只用钉钉 / 飞书登录）
 * 已存在的人（同账号或同手机号）跳过不改
 */
export async function importPeople(ctx, { table, dryRun = true, password = '' } = {}) {
  assertAdmin(ctx)
  const rows = parseRows(table)
  if (password) checkPasswordStrength(password)
  const usernames = rows.map(r => r.username).filter(Boolean)
  const mobiles = rows.map(r => r.mobile).filter(Boolean)
  const existing = await prisma.user.findMany({ where: { deletedAt: null, OR: [{ username: { in: usernames } }, { mobile: { in: mobiles } }] }, select: { username: true, mobile: true } })
  const exists = (r) => existing.some(u => (r.username && u.username === r.username) || (r.mobile && u.mobile === r.mobile))
  const preview = rows.map(r => ({ ...r, status: r.error ? 'error' : exists(r) ? 'exists' : 'new' }))
  const summary = {
    total: rows.length, new: preview.filter(r => r.status === 'new').length, exists: preview.filter(r => r.status === 'exists').length,
    errors: preview.filter(r => r.status === 'error').map(r => ({ line: r.line, name: r.name, error: r.error })),
    depts: [...new Set(rows.filter(r => r.dept.length).map(r => r.dept.join('/')))].length
  }
  if (dryRun) return { dryRun: true, summary, rows: preview.slice(0, 50) }
  const cache = new Map()
  const created = []
  const failed = []
  for (const r of preview.filter(x => x.status === 'new')) {
    try {
      const deptId = r.dept.length ? await deptByPath(ctx, r.dept, cache) : null
      const u = await users.createUser(ctx, {
        name: r.name, username: r.username, mobile: r.mobile, email: r.email, title: r.title, jobNumber: r.jobNumber,
        password: r.username && password ? password : undefined, deptIds: deptId ? [deptId] : undefined, roles: r.admin ? ['ADMIN', 'MEMBER'] : ['MEMBER']
      })
      if (r.leader && deptId) {
        const d = await prisma.department.findUnique({ where: { id: deptId }, select: { leaderIds: true } })
        await users.updateDepartment(ctx, deptId, { leaderIds: [...new Set([...(Array.isArray(d?.leaderIds) ? d.leaderIds : []), u.id])] })
      }
      created.push({ line: r.line, name: r.name, id: u.id })
    } catch (e) {
      failed.push({ line: r.line, name: r.name, error: e.message })
    }
  }
  audit(ctx, 'onboarding.importPeople', { detail: { created: created.length, failed: failed.length } })
  return { dryRun: false, summary: { ...summary, created: created.length, failed }, created }
}
