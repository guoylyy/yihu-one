// 管理员：审核台（通过 / 打回）、下架、处理举报
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/http.js'
import { briefMap } from './users.js'
import { publishVersion, studioAppDto } from './studio.js'

export async function pending(ctx, { status = 'PENDING' } = {}) {
  assertAdmin(ctx)
  const rows = await prisma.appVersion.findMany({
    where: { status: status === 'ALL' ? { in: ['PENDING', 'APPROVED', 'REJECTED'] } : status, app: { deletedAt: null } },
    orderBy: { submittedAt: status === 'PENDING' ? 'asc' : 'desc' },
    take: 100,
    include: { app: true }
  })
  const bm = await briefMap(rows.flatMap(r => [r.app.publisherId, r.reviewedBy]))
  return rows.map(r => ({
    id: r.id, version: r.version, changelog: r.changelog, status: r.status, targetScope: r.targetScope,
    submittedAt: r.submittedAt, reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, reviewer: bm.get(r.reviewedBy) || null,
    app: { id: r.app.id, code: r.app.code, kind: r.app.kind, name: r.app.name, icon: r.app.icon, iconColor: r.app.iconColor, scope: r.app.scope, listed: r.app.listed },
    publisher: bm.get(r.app.publisherId) || null
  }))
}

/** 审核详情：这个版本的内容 + 当前生效版本的内容（对比看改了什么） */
export async function detail(ctx, versionId) {
  assertAdmin(ctx)
  const v = await prisma.appVersion.findUnique({ where: { id: Number(versionId) }, include: { app: true } })
  if (!v) throw notFound('版本不存在')
  const live = v.app.liveVersionId && v.app.liveVersionId !== v.id ? await prisma.appVersion.findUnique({ where: { id: v.app.liveVersionId } }) : null
  const bm = await briefMap([v.app.publisherId, v.reviewedBy])
  return {
    id: v.id, version: v.version, changelog: v.changelog, status: v.status, payload: v.payload, permissions: v.permissions,
    targetScope: v.targetScope, targetVisibility: v.targetVisibility, submittedAt: v.submittedAt, reviewNote: v.reviewNote,
    app: studioAppDto(v.app), publisher: bm.get(v.app.publisherId) || null,
    live: live ? { version: live.version, payload: live.payload, permissions: live.permissions, targetScope: live.targetScope } : null
  }
}

export async function approve(ctx, versionId, { note } = {}) {
  assertAdmin(ctx)
  await publishVersion(ctx, versionId, { note: note ? String(note).slice(0, 1000) : null })
  return { ok: true }
}

export async function reject(ctx, versionId, { note } = {}) {
  assertAdmin(ctx)
  const text = String(note || '').trim()
  if (!text) throw badRequest('请写上打回原因，发布者据此修改')
  const v = await prisma.appVersion.findUnique({ where: { id: Number(versionId) } })
  if (!v || v.status !== 'PENDING') throw badRequest('这个版本不在待审核状态')
  await prisma.appVersion.update({ where: { id: v.id }, data: { status: 'REJECTED', reviewedBy: ctx.user.id, reviewedAt: new Date(), reviewNote: text.slice(0, 1000) } })
  audit(ctx, 'review.reject', { entityType: 'app', entityId: v.appId, detail: { version: v.version, note: text } })
  return { ok: true }
}

/** 下架：从市场和所有分享里撤下（变回仅发布者自己可见），已放到别人工作台上的也一并移除 */
export async function delist(ctx, appId, { reason } = {}) {
  assertAdmin(ctx)
  const text = String(reason || '').trim()
  if (!text) throw badRequest('请写上下架原因，发布者会看到')
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null } })
  if (!app) throw notFound('应用不存在')
  await prisma.app.update({ where: { id: app.id }, data: { scope: 'PRIVATE', listed: false, visibility: null, adminNote: `已被管理员下架：${text}`.slice(0, 500) } })
  await prisma.userApp.deleteMany({ where: { appId: app.id, userId: { not: app.publisherId || -1 } } })
  await prisma.appVersion.updateMany({ where: { appId: app.id, status: 'PENDING' }, data: { status: 'REJECTED', reviewedBy: ctx.user.id, reviewedAt: new Date(), reviewNote: `应用已下架：${text}`.slice(0, 1000) } })
  audit(ctx, 'review.delist', { entityType: 'app', entityId: app.id, detail: { reason: text } })
  return { ok: true }
}

/** 所有员工发布的应用（管理员总览，用于下架） */
export async function allApps(ctx, { q, kind, scope } = {}) {
  assertAdmin(ctx)
  const rows = await prisma.app.findMany({
    where: { deletedAt: null, publisherId: { not: null }, ...(kind ? { kind } : {}), ...(scope ? { scope } : {}) },
    orderBy: { updatedAt: 'desc' }, take: 300,
    include: { _count: { select: { users: true } } }
  })
  const k = q ? String(q).toLowerCase() : ''
  const list = rows.filter(a => !k || `${a.name} ${a.code} ${a.description || ''}`.toLowerCase().includes(k))
  const bm = await briefMap(list.map(a => a.publisherId))
  return list.map(a => studioAppDto(a, { publisher: bm.get(a.publisherId) || null, installs: a._count.users }))
}

export async function reports(ctx, { status = 'OPEN' } = {}) {
  assertAdmin(ctx)
  const rows = await prisma.appReport.findMany({ where: status === 'ALL' ? {} : { status }, orderBy: { id: 'desc' }, take: 100 })
  const apps = new Map((await prisma.app.findMany({ where: { id: { in: rows.map(r => r.appId) } } })).map(a => [a.id, a]))
  const bm = await briefMap(rows.flatMap(r => [r.userId, r.handledBy, apps.get(r.appId)?.publisherId]))
  return rows.map(r => {
    const a = apps.get(r.appId)
    return {
      id: r.id, reason: r.reason, status: r.status, note: r.note, createdAt: r.createdAt, handledAt: r.handledAt,
      reporter: bm.get(r.userId) || null, handler: bm.get(r.handledBy) || null,
      app: a ? { id: a.id, name: a.name, icon: a.icon, iconColor: a.iconColor, kind: a.kind, scope: a.scope, listed: a.listed, publisher: bm.get(a.publisherId) || null } : null
    }
  })
}

/** 处理举报：action = delist 下架应用 / dismiss 忽略 */
export async function resolveReport(ctx, id, { action, note }) {
  assertAdmin(ctx)
  const r = await prisma.appReport.findUnique({ where: { id: Number(id) } })
  if (!r || r.status !== 'OPEN') throw badRequest('这条举报已处理过')
  if (!['delist', 'dismiss'].includes(action)) throw badRequest('action 只能是 delist / dismiss')
  if (action === 'delist') await delist(ctx, r.appId, { reason: note || r.reason })
  await prisma.appReport.update({
    where: { id: r.id },
    data: { status: action === 'delist' ? 'RESOLVED' : 'DISMISSED', handledBy: ctx.user.id, handledAt: new Date(), note: note ? String(note).slice(0, 500) : null }
  })
  audit(ctx, 'review.report', { entityType: 'app', entityId: r.appId, detail: { reportId: r.id, action } })
  return { ok: true }
}
