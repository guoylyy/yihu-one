// 定时 AI 任务：到点以创建者本人的身份跑一次 AI 助手，结果存成对话，并推到本人的钉钉 / 飞书 / 企业微信（docs/设计-老板应用.md）
// 规则：
//   - 只读：定时任务里没人在旁边点确认，只给只读工具（runner 的 readOnly），要动手的事写成建议
//   - 只发给创建者本人；每人最多 tasksPerUser 个（系统设置 → AI 助手）
//   - 控制台进程里每分钟检查一次到点的任务，按 nextRunAt 抢占（同一个任务不会跑两次）；停机期间错过的，启动后补跑一次
//   - 连续失败 3 次自动停用，并告诉本人
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { loadUser } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/http.js'
import { get as getSetting } from './settings.js'
import { visibleTo } from './apps.js'
import { sendToUsers } from './openApp.js'
import { BOSS_AGENT_CODE } from './setup.js'

export const KINDS = ['daily', 'weekdays', 'weekly']
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const RUN_TIMEOUT_MS = 120_000
const MAX_FAILS = 3
const PUSH_MAX = 1800

/** 每日经营简报的提示词（任务里可以改） */
export const BRIEF_PROMPT = [
  '请为我生成今天的经营简报。',
  '先调用 get_business_overview（since 取 24 小时前）拿到各应用的关键指标、变化与风险、待我决定的事项；需要细节时再查对应应用的工具。',
  '按下面的格式写，整份控制在手机一屏以内：',
  '**总评**：一句话说公司现在怎么样。',
  '**关键数字**：最重要的 3~5 个，带单位、变化和好坏。',
  '**风险与变化**：按严重程度排，每条一句话，注明来自哪个应用。',
  '**需要您决定**：谁、什么事、截止时间，有链接就附上。',
  '**今天建议关注**：1~2 件事。',
  '没有数据的部分写「暂无」，不要编造。如果还没有任何应用提供经营数据，直接说明，并建议接入哪些应用。'
].join('\n')

// ---------------------------------------------------------------- 时间

export function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return 'Asia/Shanghai' }
}

/** 某个时刻在时区里的年月日时分、星期（周一 = 1） */
export function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
  const o = {}
  for (const p of f.formatToParts(date)) o[p.type] = p.value
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(o.weekday) + 1 }
}

/** 时区里的「某年某月某日 几点几分」→ UTC 时刻（夏令时也对） */
export function zonedToUtc(y, m, d, h, mi, tz) {
  const want = Date.UTC(y, m - 1, d, h, mi)
  let t = want
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(t), tz)
    const diff = want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi)
    if (!diff) break
    t += diff
  }
  return new Date(t)
}

/** 下一次运行时间（严格晚于 from） */
export function nextRunAt(schedule, tz, from = new Date()) {
  const [hh, mm] = schedule.time.split(':').map(Number)
  const today = partsIn(from, tz)
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i))
    const wd = ((day.getUTCDay() + 6) % 7) + 1
    if (schedule.kind === 'weekdays' && wd > 5) continue
    if (schedule.kind === 'weekly' && wd !== schedule.weekday) continue
    const t = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz)
    if (t > from) return t
  }
  return null
}

export function normalizeSchedule(s) {
  const kind = s?.kind
  if (!KINDS.includes(kind)) throw badRequest('频率只能是每天（daily）、工作日（weekdays）或每周（weekly）')
  const time = String(s?.time || '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw badRequest('时间要写成 HH:mm，如 08:00')
  const out = { kind, time }
  if (kind === 'weekly') {
    const w = Number(s.weekday)
    if (!Number.isInteger(w) || w < 1 || w > 7) throw badRequest('每周任务要选星期几（1 = 周一 … 7 = 周日）')
    out.weekday = w
  }
  return out
}

export function describeSchedule(s) {
  if (!s) return ''
  if (s.kind === 'weekdays') return `工作日 ${s.time}`
  if (s.kind === 'weekly') return `每周${WEEKDAYS[(s.weekday || 1) - 1]} ${s.time}`
  return `每天 ${s.time}`
}

const timezone = async () => validTz((await getSetting('general')).timezone)

// ---------------------------------------------------------------- 管理（本人）

const dto = (t) => ({
  id: t.id, name: t.name, prompt: t.prompt, agentAppId: t.agentAppId, schedule: t.schedule, scheduleText: describeSchedule(t.schedule),
  template: t.template, enabled: t.enabled, nextRunAt: t.nextRunAt, lastRunAt: t.lastRunAt, lastStatus: t.lastStatus, lastError: t.lastError,
  lastConversationId: t.lastConversationId, lastResult: t.lastResult, failCount: t.failCount
})

async function own(ctx, id) {
  const t = await prisma.scheduledTask.findFirst({ where: { id: Number(id), userId: ctx.user.id, deletedAt: null } })
  if (!t) throw notFound('定时任务不存在')
  return t
}

async function checkAgent(ctx, agentAppId) {
  if (!agentAppId) return null
  const app = await prisma.app.findFirst({ where: { id: Number(agentAppId), kind: 'AGENT', deletedAt: null, status: 'ACTIVE' } })
  if (!app || !visibleTo(app, ctx.user)) throw badRequest('选的 AI 助手不存在，或者你用不了')
  return app.id
}

function fields(b, creating) {
  const d = {}
  if (creating || b.name !== undefined) {
    d.name = String(b.name || '').trim()
    if (!d.name || d.name.length > 60) throw badRequest('任务名称必填，最多 60 字')
  }
  if (creating || b.prompt !== undefined) {
    d.prompt = String(b.prompt || '').trim()
    if (!d.prompt || d.prompt.length > 4000) throw badRequest('要让助手做什么必填，最多 4000 字')
  }
  if (creating || b.schedule !== undefined) d.schedule = normalizeSchedule(b.schedule)
  if (b.enabled !== undefined) d.enabled = !!b.enabled
  return d
}

export async function list(ctx) {
  const rows = await prisma.scheduledTask.findMany({ where: { userId: ctx.user.id, deletedAt: null }, orderBy: { id: 'asc' } })
  return rows.map(dto)
}

export async function create(ctx, b = {}) {
  const limit = (await getSetting('assistant')).tasksPerUser ?? 10
  if (!limit) throw badRequest('管理员关闭了定时任务')
  if (await prisma.scheduledTask.count({ where: { userId: ctx.user.id, deletedAt: null } }) >= limit) throw badRequest(`每人最多 ${limit} 个定时任务，先删掉不用的`)
  const d = fields(b, true)
  const agentAppId = await checkAgent(ctx, b.agentAppId)
  const t = await prisma.scheduledTask.create({
    data: { ...d, userId: ctx.user.id, agentAppId, template: b.template === 'brief' ? 'brief' : null, nextRunAt: nextRunAt(d.schedule, await timezone()) }
  })
  audit(ctx, 'schedule.create', { entityType: 'scheduledTask', entityId: t.id, detail: { name: t.name, schedule: describeSchedule(t.schedule) } })
  return dto(t)
}

export async function update(ctx, id, b = {}) {
  const t = await own(ctx, id)
  const d = fields(b, false)
  if (b.agentAppId !== undefined) d.agentAppId = await checkAgent(ctx, b.agentAppId)
  const schedule = d.schedule || t.schedule
  if (d.schedule || d.enabled) d.nextRunAt = nextRunAt(schedule, await timezone())
  if (d.enabled) d.failCount = 0
  const out = await prisma.scheduledTask.update({ where: { id: t.id }, data: d })
  audit(ctx, 'schedule.update', { entityType: 'scheduledTask', entityId: t.id, detail: { ...d, prompt: d.prompt ? '(已修改)' : undefined } })
  return dto(out)
}

export async function remove(ctx, id) {
  const t = await own(ctx, id)
  await prisma.scheduledTask.update({ where: { id: t.id }, data: { deletedAt: new Date(), enabled: false } })
  audit(ctx, 'schedule.delete', { entityType: 'scheduledTask', entityId: t.id, detail: { name: t.name } })
  return { ok: true }
}

/** 立即跑一次（不等结果；页面上看 lastStatus） */
export async function runNow(ctx, id) {
  const t = await own(ctx, id)
  if (t.lastStatus === 'RUNNING') throw badRequest('正在运行，稍等一下')
  await prisma.scheduledTask.update({ where: { id: t.id }, data: { lastStatus: 'RUNNING', lastError: null } })
  runTask(t).catch(e => console.error('[schedule] runNow', t.id, e.message))
  return { started: true }
}

/** 老板助理（预置的 AI 助手），这个人能用就返回它的 id */
async function bossAgentId(user) {
  const app = await prisma.app.findFirst({ where: { code: BOSS_AGENT_CODE, kind: 'AGENT', deletedAt: null, status: 'ACTIVE' } })
  return app && visibleTo(app, user) ? app.id : null
}

/** 一键开通每日经营简报：已有就改时间；建好立即跑一次，马上看到效果 */
export async function createBrief(ctx, { kind = 'weekdays', time = '08:00' } = {}) {
  const schedule = normalizeSchedule({ kind, time })
  const existing = await prisma.scheduledTask.findFirst({ where: { userId: ctx.user.id, template: 'brief', deletedAt: null } })
  const t = existing
    ? await update(ctx, existing.id, { schedule, enabled: true })
    : await create(ctx, { name: '每日经营简报', prompt: BRIEF_PROMPT, schedule, agentAppId: await bossAgentId(ctx.user), template: 'brief' })
  await runNow(ctx, t.id)
  return { ...t, lastStatus: 'RUNNING' }
}

/** 最近一次简报（首页「最新简报」卡片） */
export async function latestBrief(ctx) {
  const t = await prisma.scheduledTask.findFirst({ where: { userId: ctx.user.id, template: 'brief', deletedAt: null } })
  return t ? dto(t) : null
}

// ---------------------------------------------------------------- 执行

/** 推送正文：一屏以内，超出的截断，全文在对话里 */
export function pushText(result, url) {
  const s = String(result || '').trim()
  const body = s.length > PUSH_MAX ? s.slice(0, PUSH_MAX).replace(/\n[^\n]*$/, '') + '\n\n…' : s
  return url ? `${body}\n\n[查看全文、接着问](${url})` : body
}

export async function runTask(task) {
  const user = await loadUser(task.userId)
  if (!user) {
    await prisma.scheduledTask.update({ where: { id: task.id }, data: { enabled: false, lastStatus: 'FAILED', lastError: '账号已停用，任务已停' } })
    return
  }
  const ctx = { user, via: 'AI', ip: null }
  const tz = await timezone()
  const p = partsIn(new Date(), tz)
  const today = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
  let conversationId = null
  let text = ''
  const emit = (e) => {
    if (e.type === 'meta') conversationId = e.conversationId
    else if (e.type === 'tool_call') text = '' // 只要最后一轮（查完数据之后）的回答
    else if (e.type === 'text') text += e.delta
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), RUN_TIMEOUT_MS)
  try {
    const { chat } = await import('../agent/runner.js') // 动态加载：runner → tools → 本文件，避免循环依赖
    await chat(ctx, { message: task.prompt, appId: task.agentAppId || undefined, readOnly: true, title: `${task.name} · ${today}` }, emit, ac.signal)
    if (!text.trim()) throw new Error(ac.signal.aborted ? `${RUN_TIMEOUT_MS / 1000} 秒内没跑完` : '助手没有给出结果')
    const base = String((await getSetting('general')).publicBaseUrl || '').replace(/\/$/, '')
    const url = conversationId && base ? `${base}/assistant?c=${conversationId}${task.agentAppId ? `&app=${task.agentAppId}` : ''}` : null
    const rows = await prisma.user.findMany({ where: { id: user.id }, select: { id: true, dingUserId: true, feishuOpenId: true, wecomUserId: true } })
    const markdown = pushText(text, url)
    const sent = await sendToUsers(rows, { title: `${task.name} · ${today}`, markdown, plain: markdown.replace(/[*_`#>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), url })
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: {
        lastStatus: 'OK', lastRunAt: new Date(), lastResult: text.slice(0, 4000), lastConversationId: conversationId, failCount: 0,
        lastError: sent.sent.length ? null : `已存到对话，没有推送：${sent.skipped[0]?.reason || '没有可用的消息渠道'}`
      }
    })
  } catch (e) {
    const failCount = (task.failCount || 0) + 1
    const stop = failCount >= MAX_FAILS
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: { lastStatus: 'FAILED', lastRunAt: new Date(), lastError: String(e.message || e).slice(0, 480), failCount, lastConversationId: conversationId, ...(stop ? { enabled: false } : {}) }
    })
    if (stop) {
      const rows = await prisma.user.findMany({ where: { id: user.id }, select: { id: true, dingUserId: true, feishuOpenId: true, wecomUserId: true } })
      const md = `定时任务「${task.name}」连续失败 ${MAX_FAILS} 次，已暂停。原因：${e.message}\n\n在「个人中心 → 定时任务」里修好后重新打开。`
      await sendToUsers(rows, { title: '定时任务已暂停', markdown: md, plain: md, url: null }).catch(() => {})
    }
  } finally {
    clearTimeout(timer)
  }
}

let ticking = false
/** 跑到点的任务：先把 nextRunAt 推到下一次（抢占），抢到的才跑；一次最多 20 个，逐个跑 */
export async function tick(now = new Date()) {
  if (ticking) return 0
  ticking = true
  let ran = 0
  try {
    const tz = await timezone()
    const due = await prisma.scheduledTask.findMany({ where: { enabled: true, deletedAt: null, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 20 })
    for (const t of due) {
      const claimed = await prisma.scheduledTask.updateMany({
        where: { id: t.id, nextRunAt: t.nextRunAt, enabled: true },
        data: { nextRunAt: nextRunAt(t.schedule, tz, now), lastStatus: 'RUNNING' }
      })
      if (!claimed.count) continue
      await runTask(t).catch(e => console.error('[schedule]', t.id, e.message))
      ran++
    }
  } finally {
    ticking = false
  }
  return ran
}

/** 控制台启动时调：补算缺的下次时间、把上次没跑完（控制台重启了）的标成失败，然后每分钟检查一次 */
export async function startScheduler() {
  const tz = await timezone()
  const missing = await prisma.scheduledTask.findMany({ where: { enabled: true, deletedAt: null, nextRunAt: null } })
  for (const t of missing) await prisma.scheduledTask.update({ where: { id: t.id }, data: { nextRunAt: nextRunAt(t.schedule, tz) } })
  await prisma.scheduledTask.updateMany({ where: { lastStatus: 'RUNNING' }, data: { lastStatus: 'FAILED', lastError: '控制台重启，这次没跑完' } })
  setInterval(() => { tick().catch(e => console.error('[schedule] tick', e.message)) }, 60_000).unref()
}
