// 千人千面首页：每个人一份自己的首页布局（存在 User.prefs.home，别人看不到），可以在网页上增删排序，也可以让自己的 Agent 经 MCP 改。
// 布局是结构化 JSON，平台校验后才渲染——Agent 不能塞 HTML / 脚本（文本卡片只当纯文本显示，链接只认 http/https）。
// 没改过的人用模板首页（就是原来的工作台：问候、AI 助手、我的应用），不用 Agent 的人也能用。
// 管理员没配完平台时由前端带进开通向导（/onboarding），首页不再放「开始配置」卡片。
//
// 卡片类型：
//   greeting  问候和日期
//   assistant AI 助手输入框          apps       我的应用（工作台）
//   app       单个应用的大入口 { appId }
//   link      外链 { title, url }    text       一段文字 { title, text }
//   data      数据卡片 { title, tool, args, view, x, y }：以本人身份调一个**只读**工具（平台的或应用 MCP 的），按 view 显示结果
//             view：auto 自动 / number 数字 / list 列表 / table 表格 / line 折线（x、y 是对象数组里的字段名）
import crypto from 'node:crypto'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/http.js'
import { allToolsFor } from '../agent/agents.js'
import { runTool } from '../tools/index.js'
import * as apps from './apps.js'
import { get as getSetting } from './settings.js'
import { isAdmin } from '../lib/auth.js'

// metrics 关键指标 / decisions 待我决策 / events 风险与动态：来自各应用的标准工具（services/overview.js）；brief 最新一次经营简报
export const TYPES = ['greeting', 'assistant', 'apps', 'app', 'link', 'text', 'data', 'metrics', 'decisions', 'events', 'brief']
const OVERVIEW_TYPES = ['metrics', 'decisions', 'events', 'brief']
// 已经不用的卡片类型：存过的首页、Agent 传来的布局里有它们时直接去掉，不报错（setup：0.5.0 起换成开通向导）
const RETIRED = new Set(['setup'])
export const VIEWS = ['auto', 'number', 'list', 'table', 'line']
const MAX_CARDS = 30
const DATA_TIMEOUT_MS = 15_000
const DATA_MAX_CHARS = 60_000

export const TEMPLATE = [
  { id: 'greeting', type: 'greeting' },
  { id: 'assistant', type: 'assistant' },
  { id: 'apps', type: 'apps' }
]

/** 管理层首页：打开平台第一眼就是公司状况（docs/设计-老板应用.md） */
export const BOSS_TEMPLATE = [
  { id: 'greeting', type: 'greeting' },
  { id: 'brief', type: 'brief', title: '最新简报' },
  { id: 'metrics', type: 'metrics', title: '关键指标' },
  { id: 'decisions', type: 'decisions', title: '待我决策', width: 'half' },
  { id: 'events', type: 'events', title: '风险与动态', width: 'half' },
  { id: 'assistant', type: 'assistant' },
  { id: 'apps', type: 'apps' }
]
export const TEMPLATES = { default: TEMPLATE, boss: BOSS_TEMPLATE }

/** 没自己改过首页时用哪个模板：管理员、部门负责人默认用管理层首页（系统设置 → AI 助手里可以关） */
async function defaultTemplate(user) {
  const leader = isAdmin(user) || (user.leaderOf?.length > 0)
  return leader && (await getSetting('assistant')).leaderHome !== false ? { cards: BOSS_TEMPLATE, name: 'boss' } : { cards: TEMPLATE, name: 'default' }
}

const str = (v, max, label) => {
  const s = v == null ? '' : String(v).trim()
  if (s.length > max) throw badRequest(`${label}最多 ${max} 个字`)
  return s
}
const newId = () => crypto.randomBytes(4).toString('hex')

/** 我能用在数据卡片上的工具：只读的（平台通用 + 我能看到的应用的 MCP 工具） */
export async function dataTools(user) {
  return (await allToolsFor(user)).filter(t => !t.write)
}

/**
 * 校验并规范化一份布局。readOnlyTools：能用在数据卡片上的工具名集合（不传则不校验工具，单元测试用）
 * 规则：类型白名单；id 唯一（没有就生成）；文字限长；链接只认 http/https；数据卡片只能用只读工具
 */
export function normalizeCards(input, readOnlyTools = null) {
  if (!Array.isArray(input)) throw badRequest('cards 要是数组')
  if (input.length > MAX_CARDS) throw badRequest(`首页最多 ${MAX_CARDS} 张卡片`)
  const seen = new Set()
  return input.filter(c => !RETIRED.has(c?.type)).map((c, i) => {
    const type = String(c?.type || '')
    if (!TYPES.includes(type)) throw badRequest(`第 ${i + 1} 张卡片的类型「${type}」不支持，只能是 ${TYPES.join(' / ')}`)
    let id = String(c.id || '').trim()
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || seen.has(id)) id = newId()
    seen.add(id)
    const out = { id, type }
    if (c.width === 'half') out.width = 'half'
    if (c.hidden) out.hidden = true
    if (type === 'app') {
      out.appId = Number(c.appId)
      if (!Number.isInteger(out.appId) || out.appId <= 0) throw badRequest(`第 ${i + 1} 张卡片（应用入口）缺少 appId`)
    }
    if (type === 'link') {
      out.title = str(c.title, 40, '链接标题') || '链接'
      out.url = str(c.url, 500, '链接地址')
      if (!/^https?:\/\/\S+$/i.test(out.url)) throw badRequest(`第 ${i + 1} 张卡片的链接要以 http:// 或 https:// 开头`)
    }
    if (type === 'text') {
      out.title = str(c.title, 40, '标题')
      out.text = str(c.text, 2000, '文字')
      if (!out.text) throw badRequest(`第 ${i + 1} 张卡片（文字）没有内容`)
    }
    if (OVERVIEW_TYPES.includes(type)) out.title = str(c.title, 40, '标题') || undefined
    if (type === 'data') {
      out.title = str(c.title, 40, '标题') || '数据'
      out.tool = str(c.tool, 120, '工具名')
      if (!out.tool) throw badRequest(`第 ${i + 1} 张卡片（数据）要指定 tool`)
      if (readOnlyTools && !readOnlyTools.has(out.tool)) throw badRequest(`数据卡片「${out.title}」用的工具 ${out.tool} 不存在、你用不了，或者会改数据（数据卡片只能用只读工具）`)
      out.args = c.args && typeof c.args === 'object' && !Array.isArray(c.args) ? c.args : {}
      if (JSON.stringify(out.args).length > 2000) throw badRequest(`数据卡片「${out.title}」的参数太长`)
      out.view = VIEWS.includes(c.view) ? c.view : 'auto'
      if (out.view === 'line') {
        out.x = str(c.x, 60, 'x 字段'); out.y = str(c.y, 60, 'y 字段')
        if (!out.x || !out.y) throw badRequest(`数据卡片「${out.title}」用折线图要写 x 和 y（结果数组里对象的字段名）`)
      }
      if (c.field) out.field = str(c.field, 120, '取值路径') // 结果是对象时从哪个字段取，如 data.list
    }
    return out
  })
}

async function freshPrefs(userId) {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { prefs: true } })
  return row?.prefs || {}
}

/** 我的首页：生效的布局 + 编辑首页要用的目录（能放的应用、能用在数据卡片上的工具） */
export async function getHome(ctx, { withCatalog = true } = {}) {
  const prefs = await freshPrefs(ctx.user.id)
  const home = prefs.home
  const custom = !!(home && Array.isArray(home.cards))
  const tpl = custom ? null : await defaultTemplate(ctx.user)
  const out = {
    custom,
    cards: custom ? home.cards.filter(c => !RETIRED.has(c?.type)) : tpl.cards,
    template: tpl?.name || null,
    updatedAt: home?.updatedAt || null,
    source: home?.source || 'template'
  }
  if (withCatalog) {
    const [mine, tools] = await Promise.all([apps.listMyApps(ctx), dataTools(ctx.user)])
    out.catalog = {
      types: TYPES, views: VIEWS, templates: Object.keys(TEMPLATES),
      apps: mine.map(a => ({ id: a.id, name: a.name, icon: a.icon, description: a.description })),
      tools: tools.map(t => ({ name: t.name, label: t.label, description: t.description, appName: t.appName || null }))
    }
  }
  return out
}

export async function saveHome(ctx, cards) {
  const readOnly = new Set((await dataTools(ctx.user)).map(t => t.name))
  const normalized = normalizeCards(cards, readOnly)
  const prefs = await freshPrefs(ctx.user.id)
  const home = { cards: normalized, updatedAt: new Date().toISOString(), source: ctx.via === 'WEB' ? 'web' : 'agent' }
  await prisma.user.update({ where: { id: ctx.user.id }, data: { prefs: { ...prefs, home } } })
  audit(ctx, 'home.update', { entityType: 'user', entityId: ctx.user.id, detail: { cards: normalized.length, types: [...new Set(normalized.map(c => c.type))] } })
  return { custom: true, cards: normalized, updatedAt: home.updatedAt, source: home.source }
}

export async function resetHome(ctx) {
  const prefs = await freshPrefs(ctx.user.id)
  if (prefs.home) {
    const { home, ...rest } = prefs
    await prisma.user.update({ where: { id: ctx.user.id }, data: { prefs: rest } })
    audit(ctx, 'home.reset', { entityType: 'user', entityId: ctx.user.id })
  }
  const tpl = await defaultTemplate(ctx.user)
  return { custom: false, cards: tpl.cards, template: tpl.name, updatedAt: null, source: 'template' }
}

/** 套用模板（default 默认 / boss 管理层）：存成自己的首页，之后照常增删 */
export async function applyTemplate(ctx, name) {
  const cards = TEMPLATES[name]
  if (!cards) throw badRequest(`没有模板「${name}」，可选：${Object.keys(TEMPLATES).join(' / ')}`)
  return saveHome(ctx, cards)
}

/** 数据卡片取数：只能取自己首页上的卡片，以本人身份调只读工具；超时、结果过大都给可读的错误 */
export async function cardData(ctx, cardId) {
  const { cards } = await getHome(ctx, { withCatalog: false })
  const card = cards.find(c => c.id === String(cardId) && c.type === 'data')
  if (!card) throw notFound('首页上没有这张数据卡片')
  const tool = (await dataTools(ctx.user)).find(t => t.name === card.tool)
  if (!tool) throw badRequest(`工具 ${card.tool} 现在用不了（应用下线了、你没权限了，或者它变成了写操作）`)
  const run = tool.external ? tool.run(ctx, card.args || {}) : runTool(ctx, tool.name, card.args || {})
  let timer
  const result = await Promise.race([
    run,
    new Promise((_, reject) => { timer = setTimeout(() => reject(badRequest('取数超时（15 秒）')), DATA_TIMEOUT_MS) })
  ]).finally(() => clearTimeout(timer))
  const text = JSON.stringify(result ?? null)
  if (text.length > DATA_MAX_CHARS) throw badRequest('结果太大，放不进卡片：给工具加上筛选参数（如只取前 10 条）')
  return { result: result ?? null, at: new Date().toISOString() }
}
