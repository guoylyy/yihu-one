// Agent 原生发布：让用户在自己的 Agent（Claude Code、Codex 等）里一句话把应用发到平台上。
// 这里只是 MCP 的新入口，不是新的执行通道——全部调用创作中心（studio）原有的建应用 → 存草稿 → 提交，
// 审核规则、可见范围、额度、谁能发什么，和网页上完全一样；代码应用照旧审核通过后由 PlatformOp → yh agent 安装
import prisma from '../lib/prisma.js'
import { isAdmin, isDeveloper } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/http.js'
import { get as getSetting } from './settings.js'
import { checkCode } from './platform.js'
import { sanitizeHtml, inferPermissions } from './codegen.js'
import { allToolsFor } from '../agent/agents.js'
import { openUrlOf } from './apps.js'
import * as studio from './studio.js'

const KIND_LABEL = { AGENT: 'AI 助手', LITE: '轻应用', EXTERNAL: '外部应用', HOSTED: '代码应用', SKILL: 'Skill' }
const SCOPE_LABEL = { PRIVATE: '仅自己', SHARED: '指定同事 / 部门', MARKET: '全公司市场' }
const CODE = /^[a-z][a-z0-9-]{1,30}$/

async function baseUrl() {
  const { publicBaseUrl } = await getSetting('general')
  return String(publicBaseUrl || '').replace(/\/+$/, '')
}
const absolute = (base, u) => (u && u.startsWith('/') ? base + u : u || null)

// ---------- 我能发什么、发过什么 ----------

export async function myPublishing(ctx) {
  const market = await getSetting('market')
  const enabled = market.publishEnabled || isAdmin(ctx.user)
  const base = await baseUrl()
  const apps = await studio.listMine(ctx)
  return {
    canPublish: {
      LITE: enabled, AGENT: enabled, SKILL: enabled, EXTERNAL: enabled,
      HOSTED: enabled && isDeveloper(ctx.user)
    },
    notes: [
      enabled ? null : '管理员暂时关闭了员工发布',
      isDeveloper(ctx.user) ? null : '代码应用（HOSTED）只有管理员和开发者能发；可以做成轻应用（单页面）或外部应用',
      '上架全公司市场一律要管理员审核；代码应用每次都要审核；外部应用分享给同事也要审核；其他「仅自己 / 指定同事」马上生效'
    ].filter(Boolean),
    apps: apps.map(a => ({
      id: a.id, kind: a.kind, kindLabel: KIND_LABEL[a.kind], name: a.name, code: a.code,
      scope: a.scope, scopeLabel: SCOPE_LABEL[a.scope], live: !!a.liveVersionId,
      latestVersion: a.latest?.version, latestStatus: a.latest?.status,
      url: a.liveVersionId || a.url ? absolute(base, openUrlOf(a)) : null
    }))
  }
}

/** code 能不能用；不能用时给几个能用的（REQ-03：冲突 / 保留字给替代建议） */
export async function checkAppCode(ctx, code) {
  const c = String(code || '').trim().toLowerCase()
  let reason = null
  try { checkCode(c) } catch (e) { reason = e.message }
  if (!reason && await prisma.app.findUnique({ where: { code: c } })) reason = `${c} 已被占用`
  if (!reason) return { code: c, available: true }
  const stem = (c.replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z]+/, '').replace(/-+/g, '-').replace(/-$/, '') || 'app').slice(0, 24)
  const who = String(ctx.user.username || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  const candidates = [...new Set([`${stem}-app`, `${stem}-2`, `${stem}-3`, who && `${stem}-${who}`, `${stem}-one`].filter(Boolean))]
  const suggestions = []
  for (const s of candidates) {
    if (!CODE.test(s)) continue
    try { checkCode(s) } catch { continue }
    if (!(await prisma.app.findUnique({ where: { code: s } }))) suggestions.push(s)
    if (suggestions.length >= 3) break
  }
  return { code: c, available: false, reason, suggestions }
}

// ---------- 发布 ----------

/** 发给谁 → studio.submit 的参数 */
function target({ scope = 'PRIVATE', userIds, deptIds }) {
  if (!['PRIVATE', 'SHARED', 'MARKET'].includes(scope)) throw badRequest('scope 只能是 PRIVATE / SHARED / MARKET')
  return { scope, visibility: scope === 'PRIVATE' ? undefined : { userIds: userIds || [], deptIds: deptIds || [] } }
}

async function ownApp(ctx, id) {
  const app = await prisma.app.findFirst({ where: { id: Number(id), deletedAt: null, publisherId: ctx.user.id } })
  if (!app) throw notFound('没有这个应用，或者它不是你发布的')
  return app
}

/**
 * 发布一个应用（新建或出新版本）。kind：
 *   LITE     轻应用：html 传完整的单文件页面（跑在沙箱里，不能联网；数据、AI、只读工具走 window.yh）
 *   EXTERNAL 外部应用：url（+ 可选 redirectUris 接统一登录、mcpUrl 接 AI 工具）
 *   HOSTED   代码应用：git 仓库（根目录要有 yh-app.json 和 Dockerfile，code 与清单一致），每次都要管理员审核
 * 名称、简介、图标没给就让 Agent 先根据项目提建议、问用户确认后再调（平台不替用户拍板）
 */
export async function publishApp(ctx, b) {
  let app
  if (b.appId) {
    app = await ownApp(ctx, b.appId)
    if (b.kind && b.kind !== app.kind) throw badRequest(`这个应用是${KIND_LABEL[app.kind]}，不能改成${KIND_LABEL[b.kind] || b.kind}`)
  } else {
    if (!['LITE', 'EXTERNAL', 'HOSTED'].includes(b.kind)) throw badRequest('kind 只能是 LITE / EXTERNAL / HOSTED（Skill 用 publish_skill）')
    if (!b.name) throw badRequest('要有名称：先根据项目给用户几个建议，用户确认后再发布')
    if (b.kind !== 'LITE') {
      const c = await checkAppCode(ctx, b.code)
      if (!c.available) throw badRequest(`${c.reason}${c.suggestions?.length ? `。可以用：${c.suggestions.join('、')}（代码应用要和仓库里 yh-app.json 的 code 一致）` : ''}`)
    }
    const created = await studio.createApp(ctx, { kind: b.kind, name: b.name, code: b.code, description: b.description, icon: b.icon, iconColor: b.iconColor, category: b.category })
    app = await prisma.app.findUnique({ where: { id: created.id } })
  }
  // 上架信息（改了马上生效，和网页「上架信息」一样）
  const listing = {}
  for (const k of ['name', 'description', 'icon', 'iconColor', 'category']) if (b.appId && b[k] !== undefined) listing[k] = b[k]
  if (Object.keys(listing).length) await studio.updateListing(ctx, app.id, listing)

  // 内容 + 申请的权限 → 草稿
  const draft = {}
  if (app.kind === 'LITE' && b.html !== undefined) {
    const html = sanitizeHtml(String(b.html || '').trim())
    const readOnly = new Set((await allToolsFor(ctx.user)).filter(t => !t.write).map(t => t.name))
    draft.payload = { html }
    draft.permissions = inferPermissions(html, readOnly)
  }
  if (app.kind === 'EXTERNAL' && (b.url !== undefined || b.redirectUris !== undefined || b.mcpUrl !== undefined)) {
    draft.payload = { ...(b.url !== undefined ? { url: b.url } : {}), ...(b.redirectUris !== undefined ? { redirectUris: b.redirectUris } : {}), ...(b.mcpUrl !== undefined ? { mcpUrl: b.mcpUrl } : {}) }
  }
  if (app.kind === 'HOSTED' && (b.git !== undefined || b.branch !== undefined)) {
    draft.payload = { ...(b.git !== undefined ? { git: b.git } : {}), ...(b.branch !== undefined ? { branch: b.branch } : {}) }
  }
  if ((app.kind === 'EXTERNAL' || app.kind === 'HOSTED') && b.userInfo !== undefined) draft.permissions = { scopes: b.userInfo }
  if (Object.keys(draft).length) await studio.saveDraft(ctx, app.id, draft)

  const r = await studio.submit(ctx, app.id, { ...target(b), version: b.version, changelog: b.changelog })
  const status = await publishStatus(ctx, app.id)
  return {
    ...status,
    result: r.status === 'PENDING'
      ? (app.kind === 'HOSTED' ? '已提交，等管理员审核；审核通过后平台自动安装，用 publish_status 看进度' : '已提交，等管理员审核通过后生效')
      : '已生效'
  }
}

/** 改发布范围（应用和 Skill 都行）。审核规则同网页：扩大到要审核的范围时，审核通过前仍按原范围 */
export async function setVisibility(ctx, { appId, scope, userIds, deptIds }) {
  const app = await ownApp(ctx, appId)
  const r = await studio.submit(ctx, app.id, target({ scope, userIds, deptIds }))
  return { ...(await publishStatus(ctx, app.id)), result: r.status === 'PENDING' ? '已提交审核，通过后按新范围生效' : '已生效' }
}

// ---------- 进度 ----------

const ANSI = /\x1b\[[0-9;]*m/g

/** 从 yh 的输出里挑人能看懂的：✗ 开头的错误行、最后几行 */
export function summarizeLog(log) {
  const lines = String(log || '').replace(ANSI, '').split('\n').map(l => l.trimEnd()).filter(Boolean)
  const errors = lines.filter(l => /✗|❌|失败|错误|error:/i.test(l)).slice(-3)
  return { reason: errors.length ? errors.join('\n') : null, tail: lines.slice(-12).join('\n') }
}

export async function publishStatus(ctx, appId) {
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null } })
  if (!app || (app.publisherId !== ctx.user.id && !isAdmin(ctx.user))) throw notFound('没有这个应用，或者它不是你发布的')
  const base = await baseUrl()
  const versions = await prisma.appVersion.findMany({ where: { appId: app.id }, orderBy: { id: 'desc' }, take: 3 })
  const pending = versions.find(v => v.status === 'PENDING')
  const rejected = versions.find(v => v.status === 'REJECTED' && (!pending || v.id > pending.id))
  const out = {
    id: app.id, kind: app.kind, name: app.name, code: app.code,
    scope: app.scope, scopeLabel: SCOPE_LABEL[app.scope], listed: app.listed,
    live: app.kind === 'HOSTED' || app.kind === 'EXTERNAL' ? !!app.url : !!app.liveVersionId,
    url: app.liveVersionId || app.url ? absolute(base, openUrlOf(app)) : null,
    editUrl: `${base}/studio/${app.id}`,
    review: pending ? { status: '待管理员审核', version: pending.version, submittedAt: pending.submittedAt }
      : rejected ? { status: '被打回', version: rejected.version, note: rejected.reviewNote } : null,
    versions: versions.map(v => ({ version: v.version, status: v.status, at: v.reviewedAt || v.submittedAt || v.updatedAt }))
  }
  if (app.kind === 'HOSTED') {
    const op = await prisma.platformOp.findFirst({ where: { appCode: app.code }, orderBy: { id: 'desc' } })
    const deploy = await prisma.deployRecord.findFirst({ where: { appCode: app.code }, orderBy: { id: 'desc' } })
    if (op) {
      const s = summarizeLog(op.log)
      out.deployment = {
        action: { INSTALL: '安装', DEPLOY: '发布', START: '启动', STOP: '停用', RESTART: '重启', REMOVE: '移除', LOGS: '取日志' }[op.kind] || op.kind,
        status: { PENDING: '排队中（等平台机器上的 yh agent 领取）', RUNNING: '进行中', SUCCESS: '成功', FAILED: '失败' }[op.status] || op.status,
        at: op.finishedAt || op.startedAt || op.createdAt,
        ...(op.status === 'FAILED' ? { reason: s.reason || '没有明确的错误行，见 logTail', logTail: s.tail } : {})
      }
    } else if (!app.managed) {
      out.deployment = { status: pending ? '审核通过后自动安装' : '还没有安装任务' }
    }
    if (deploy) out.lastRelease = { result: deploy.result, version: deploy.version, subject: deploy.subject, at: deploy.createdAt }
  }
  return out
}
