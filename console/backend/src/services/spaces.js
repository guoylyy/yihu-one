// 空间（租户）：一套平台里相互隔离的组织边界——自己公司、兄弟公司、客户各一个空间。
// 规则（只在这里定义，其他地方调这里的函数，不要另写判断）：
//   - 每个人、部门、知识库属于一个空间；应用属于一个空间，管理员可以再分享给别的空间（extraSpaceIds）
//   - 不同空间的人互相看不到：同事、部门、应用、Skill、知识库都按空间收敛；应用通过统一登录拿到用户所在的空间
//   - 管理员（ADMIN）是平台管理员，跨空间可见、可运维
//   - id=1 是默认空间，没分空间之前的数据全在里面；只有一个空间时界面上不出现空间
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin, isAdmin } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/http.js'
import { normalizeBrand, resolveBrand, catalog } from './theme.js'

export const DEFAULT_SPACE_ID = 1
export const KINDS = ['INTERNAL', 'CUSTOMER']

const sid = (v) => Number(v ?? DEFAULT_SPACE_ID) || DEFAULT_SPACE_ID

/** 应用能在哪些空间用：所属空间 + 分享给的空间 */
export function spacesOfApp(app) {
  const extra = Array.isArray(app?.extraSpaceIds) ? app.extraSpaceIds.map(Number).filter(Boolean) : []
  return [...new Set([sid(app?.spaceId), ...extra])]
}

/** 应用在不在这个人的空间里（管理员跨空间） */
export function appInSpace(app, user) {
  if (isAdmin(user)) return true
  return spacesOfApp(app).includes(sid(user?.spaceId))
}

/**
 * 查人 / 部门时按哪个空间收敛：普通人只能看自己空间；管理员可以指定空间，不指定 = 全部
 * 返回 Prisma where 片段（{} 表示不限）
 */
export function spaceWhere(user, requested) {
  if (!isAdmin(user)) return { spaceId: sid(user?.spaceId) }
  return requested ? { spaceId: Number(requested) } : {}
}

let cache = null
let cacheAt = 0
/** 全部空间（短缓存，统一登录每次都要带空间信息） */
export async function allSpaces() {
  if (cache && Date.now() - cacheAt < 30_000) return cache
  cache = await prisma.space.findMany({ where: { deletedAt: null }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] })
  cacheAt = Date.now()
  return cache
}
const invalidate = () => { cache = null }

/** 给应用 / 统一登录的空间信息 */
export async function spaceBrief(spaceId) {
  const s = (await allSpaces()).find(x => x.id === sid(spaceId))
  return s ? { id: s.id, code: s.code, name: s.name } : { id: sid(spaceId), code: 'default', name: '默认空间' }
}

/** 空间自己的 VI（名称 / LOGO / 主题）；没设置返回 null = 跟随平台 */
export async function spaceBrand(spaceId) {
  const s = (await allSpaces()).find(x => x.id === sid(spaceId))
  return resolveBrand(s?.brand)
}

// ---------- 管理（管理员） ----------

/** 编辑空间 VI 用：令牌定义 + 预设 */
export function themeCatalog(ctx) {
  assertAdmin(ctx)
  return catalog()
}

export async function list(ctx) {
  assertAdmin(ctx)
  const spaces = await allSpaces()
  const count = async (model) => {
    const rows = await prisma[model].groupBy({ by: ['spaceId'], where: { deletedAt: null }, _count: { _all: true } })
    return new Map(rows.map(r => [r.spaceId, r._count._all]))
  }
  const [users, depts, apps, kbs] = await Promise.all([count('user'), count('department'), count('app'), count('knowledgeBase').catch(() => new Map())])
  return spaces.map(s => ({
    id: s.id, code: s.code, name: s.name, kind: s.kind, sort: s.sort, isDefault: s.id === DEFAULT_SPACE_ID, brand: s.brand || null,
    users: users.get(s.id) || 0, departments: depts.get(s.id) || 0, apps: apps.get(s.id) || 0, knowledgeBases: kbs.get(s.id) || 0
  }))
}

function fields(b, creating) {
  const d = {}
  if (creating || b.code !== undefined) {
    d.code = String(b.code || '').trim()
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(d.code)) throw badRequest('空间 code 要小写字母开头，只含小写字母、数字、短横线（2~40 位），如 acme')
  }
  if (creating || b.name !== undefined) {
    d.name = String(b.name || '').trim()
    if (!d.name || d.name.length > 100) throw badRequest('空间名称必填，最多 100 字')
  }
  if (b.kind !== undefined) {
    if (!KINDS.includes(b.kind)) throw badRequest('类型只能是 INTERNAL（自己公司）或 CUSTOMER（客户）')
    d.kind = b.kind
  }
  if (b.sort !== undefined) d.sort = Number(b.sort) || 0
  if (b.brand !== undefined) {
    try { d.brand = normalizeBrand(b.brand) ?? Prisma.DbNull } catch (e) { throw badRequest(e.message) }
  }
  return d
}

export async function create(ctx, b) {
  assertAdmin(ctx)
  const d = fields(b || {}, true)
  if (await prisma.space.findUnique({ where: { code: d.code } })) throw badRequest(`空间 code ${d.code} 已被占用`)
  const s = await prisma.space.create({ data: d })
  invalidate()
  audit(ctx, 'space.create', { entityType: 'space', entityId: s.id, detail: { code: s.code, name: s.name } })
  return s
}

export async function update(ctx, id, b) {
  assertAdmin(ctx)
  const s = await prisma.space.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!s) throw notFound('空间不存在')
  const d = fields(b || {}, false)
  if (s.id === DEFAULT_SPACE_ID && d.code && d.code !== s.code) throw badRequest('默认空间的 code 不能改')
  if (d.code && d.code !== s.code && await prisma.space.findUnique({ where: { code: d.code } })) throw badRequest(`空间 code ${d.code} 已被占用`)
  const out = await prisma.space.update({ where: { id: s.id }, data: d })
  invalidate()
  audit(ctx, 'space.update', { entityType: 'space', entityId: s.id, detail: { ...d, ...(d.brand !== undefined ? { brand: '(已修改)' } : {}) } })
  return out
}

/** 只能删空的空间（没有人、部门、应用、知识库）：不会产生孤儿数据 */
export async function remove(ctx, id) {
  assertAdmin(ctx)
  const s = await prisma.space.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!s) throw notFound('空间不存在')
  if (s.id === DEFAULT_SPACE_ID) throw badRequest('默认空间不能删')
  const where = { spaceId: s.id, deletedAt: null }
  const [u, d, a, k] = await Promise.all([prisma.user.count({ where }), prisma.department.count({ where }), prisma.app.count({ where }), prisma.knowledgeBase.count({ where: { spaceId: s.id } })])
  if (u + d + a + k) throw badRequest(`空间里还有 ${u} 个人、${d} 个部门、${a} 个应用、${k} 个知识库，先挪走或删掉`)
  await prisma.space.update({ where: { id: s.id }, data: { deletedAt: new Date(), code: `${s.code}~${s.id}` } })
  invalidate()
  audit(ctx, 'space.delete', { entityType: 'space', entityId: s.id, detail: { code: s.code } })
  return { ok: true }
}

/** 校验空间存在（给用户 / 部门 / 应用 / 知识库设空间时用） */
export async function assertSpace(spaceId) {
  const s = (await allSpaces()).find(x => x.id === Number(spaceId))
  if (!s) throw badRequest('空间不存在')
  return s
}
