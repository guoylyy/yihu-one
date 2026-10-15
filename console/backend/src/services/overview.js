// 经营概览：把各应用的「标准工具」合成一份，给老板的简报、老板助理和管理层首页用（docs/设计-老板应用.md）
//
// 应用想出现在老板的视野里，就在 MCP 里实现这三个只读工具（名字固定，平台按名字认）：
//   get_key_metrics({ period })     → { metrics: [{ name, value, unit?, change?, trend?, good?, note?, url? }] }
//   get_daily_summary({ since })    → { items:   [{ title, detail?, level, at?, url? }] }
//   list_pending_decisions()        → { items:   [{ id, title, detail?, requester?, deadline?, url? }] }
// 以当前用户身份调用（只给他能看的），并行、每个应用限时；应用的返回是不可信输入，这里统一清洗、截断
import { loadAppTools } from '../agent/appTools.js'

export const STANDARD = { metrics: 'get_key_metrics', events: 'get_daily_summary', decisions: 'list_pending_decisions' }
const APP_TIMEOUT_MS = 10_000
const CACHE_MS = 60_000
const LEVELS = ['risk', 'warn', 'info']
const TRENDS = ['up', 'down', 'flat']

const text = (v, max) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max))
const url = (v) => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim().slice(0, 500) : null)
const list = (r, key) => (Array.isArray(r?.[key]) ? r[key] : Array.isArray(r) ? r : [])

/** 应用返回 → 规整的指标（最多 8 个） */
export function cleanMetrics(r) {
  return list(r, 'metrics').filter(m => m && typeof m === 'object' && text(m.name, 40)).slice(0, 8).map(m => ({
    name: text(m.name, 40),
    value: typeof m.value === 'number' && Number.isFinite(m.value) ? m.value : text(m.value, 40),
    unit: text(m.unit, 12) || null,
    change: typeof m.change === 'number' && Number.isFinite(m.change) ? m.change : (text(m.change, 30) || null),
    trend: TRENDS.includes(m.trend) ? m.trend : null,
    good: typeof m.good === 'boolean' ? m.good : null,
    note: text(m.note, 120) || null,
    url: url(m.url)
  }))
}

/** 应用返回 → 规整的动态（最多 20 条，风险在前） */
export function cleanEvents(r) {
  const items = list(r, 'items').filter(e => e && typeof e === 'object' && text(e.title, 120)).slice(0, 20).map(e => ({
    title: text(e.title, 120),
    detail: text(e.detail, 300) || null,
    level: LEVELS.includes(e.level) ? e.level : 'info',
    at: text(e.at, 40) || null,
    url: url(e.url)
  }))
  return items.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
}

/** 应用返回 → 规整的待决策事项（最多 20 条） */
export function cleanDecisions(r) {
  return list(r, 'items').filter(d => d && typeof d === 'object' && text(d.title, 120)).slice(0, 20).map(d => ({
    id: text(d.id, 60) || null,
    title: text(d.title, 120),
    detail: text(d.detail, 300) || null,
    requester: text(d.requester, 40) || null,
    deadline: text(d.deadline, 40) || null,
    url: url(d.url)
  }))
}

const CLEAN = { metrics: cleanMetrics, events: cleanEvents, decisions: cleanDecisions }

/** 实现了标准工具的应用：[{ app, code, tools: { metrics?, events?, decisions? } }] */
export function standardToolsByApp(appTools) {
  const byApp = new Map()
  for (const t of appTools) {
    if (!t.appCode) continue
    const part = Object.keys(STANDARD).find(k => t.toolName === STANDARD[k])
    if (!part) continue
    if (!byApp.has(t.appCode)) byApp.set(t.appCode, { app: t.appName, code: t.appCode, tools: {} })
    byApp.get(t.appCode).tools[part] = t
  }
  return [...byApp.values()]
}

const withTimeout = (p, ms) => {
  let timer
  return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${ms / 1000} 秒内没有返回`)), ms) })]).finally(() => clearTimeout(timer))
}

/**
 * 经营概览。since：动态从什么时候算起（默认 24 小时前）；period：指标口径 today / week / month
 * 返回 { since, generatedAt, apps: [{ app, code, metrics, events, decisions, errors }] }
 */
export async function businessOverview(ctx, { since, period } = {}) {
  const sinceIso = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : new Date(Date.now() - 24 * 3600_000).toISOString()
  const per = ['today', 'week', 'month'].includes(period) ? period : 'month'
  const args = { metrics: { period: per }, events: { since: sinceIso }, decisions: {} }
  const apps = standardToolsByApp(await loadAppTools(ctx.user))
  const out = await Promise.all(apps.map(async (a) => {
    const row = { app: a.app, code: a.code, metrics: [], events: [], decisions: [], errors: [] }
    await Promise.all(Object.entries(a.tools).map(async ([part, tool]) => {
      try {
        const r = await withTimeout(tool.run(ctx, args[part]), APP_TIMEOUT_MS)
        row[part] = CLEAN[part](typeof r === 'string' ? safeJson(r) : r)
      } catch (e) {
        row.errors.push(`${STANDARD[part]}：${text(e.message, 200)}`)
      }
    }))
    return row
  }))
  return { since: sinceIso, period: per, generatedAt: new Date().toISOString(), apps: out }
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return null }
}

// 首页卡片短时间内会一起来取（指标、待决策、动态三张卡），按人缓存一分钟
const cache = new Map()
export async function cachedOverview(ctx) {
  const hit = cache.get(ctx.user.id)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const data = await businessOverview(ctx)
  if (cache.size > 2000) cache.clear()
  cache.set(ctx.user.id, { at: Date.now(), data })
  return data
}

/** 首页卡片用的扁平数据：每条带上来自哪个应用 */
export async function overviewForHome(ctx) {
  const o = await cachedOverview(ctx)
  const flat = (part) => o.apps.flatMap(a => a[part].map(x => ({ ...x, app: a.app })))
  return {
    generatedAt: o.generatedAt,
    hasSources: o.apps.length > 0,
    metrics: flat('metrics'),
    events: flat('events').sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)),
    decisions: flat('decisions'),
    errors: o.apps.filter(a => a.errors.length).map(a => ({ app: a.app, errors: a.errors }))
  }
}
