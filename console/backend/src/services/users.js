// 用户与组织: 用户 / 部门的查询与维护, 账号密码, 钉钉登录落人, 通讯录同步
import prisma from '../lib/prisma.js'
import { assertSpace, DEFAULT_SPACE_ID } from './spaces.js'
import * as ding from '../lib/dingtalk.js'
import * as feishu from '../lib/feishu.js'
import { audit } from '../lib/audit.js'
import { assertAdmin, hashPassword, checkPasswordStrength, ROLES } from '../lib/auth.js'
import { get as getSetting } from './settings.js'
import { badRequest, forbidden, notFound, paging } from '../lib/http.js'

export const brief = (u) => (u ? { id: u.id, name: u.name, avatar: u.avatar || null } : null)

/** 批量取用户简要信息, 返回 Map<id, Brief> */
export async function briefMap(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean).map(Number))]
  if (!uniq.length) return new Map()
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, avatar: true } })
  return new Map(rows.map(r => [r.id, brief(r)]))
}

const USERNAME = /^[a-zA-Z][a-zA-Z0-9_.-]{1,49}$/
const rolesOf = (u) => (Array.isArray(u.roles) && u.roles.length ? u.roles : ['MEMBER'])

function checkRoles(roles) {
  if (!Array.isArray(roles) || roles.some(r => !ROLES.includes(r))) throw badRequest(`roles 只能是 ${ROLES.join(' / ')}`)
  return roles.length ? roles : ['MEMBER']
}

/** 部门只能是这个人所在空间的（不同空间的组织架构互不相干）。写库之前先校验，免得留下半截数据 */
async function checkDepts(deptIds, spaceId) {
  const ids = [...new Set((deptIds || []).map(Number).filter(Boolean))]
  if (ids.length && spaceId) {
    const ok = new Set((await prisma.department.findMany({ where: { id: { in: ids }, spaceId: Number(spaceId), deletedAt: null }, select: { id: true } })).map(d => d.id))
    if (ids.some(id => !ok.has(id))) throw badRequest('部门要选这个人所在空间的')
  }
}

async function setDepts(userId, deptIds, spaceId) {
  await checkDepts(deptIds, spaceId)
  const ids = [...new Set((deptIds || []).map(Number).filter(Boolean))]
  await prisma.userDept.deleteMany({ where: { userId } })
  if (ids.length) await prisma.userDept.createMany({ data: ids.map((id, i) => ({ userId, departmentId: id, isPrimary: i === 0 })) })
}

/** 还剩几个可用的管理员(排除某人) */
async function otherAdmins(excludeId) {
  const rows = await prisma.user.findMany({ where: { deletedAt: null, active: true, id: { not: excludeId } }, select: { roles: true } })
  return rows.filter(r => rolesOf(r).includes('ADMIN')).length
}

// ---------- 查询 ----------

function userDto(u) {
  return {
    id: u.id, username: u.username, name: u.name, avatar: u.avatar, mobile: u.mobile, email: u.email,
    title: u.title, jobNumber: u.jobNumber, active: u.active, dingUserId: u.dingUserId,
    feishuBound: !!u.feishuOpenId, wecomBound: !!u.wecomUserId, feishuOpenId: u.feishuOpenId, wecomUserId: u.wecomUserId,
    hasPassword: !!u.passwordHash, roles: rolesOf(u), lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, spaceId: u.spaceId ?? DEFAULT_SPACE_ID,
    depts: (u.depts || []).map(d => ({ id: d.department.id, name: d.department.name, isPrimary: d.isPrimary }))
  }
}

/** space：按空间收敛的条件（spaces.spaceWhere 给的）；不传 = 不限（只有平台内部用） */
export async function listUsers({ keyword, deptId, includeInactive, space = {}, ...q }) {
  const { skip, take } = paging(q)
  const where = { deletedAt: null, ...space, ...(includeInactive === true || includeInactive === 'true' ? {} : { active: true }) }
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { username: { contains: keyword } },
      { jobNumber: { contains: keyword } },
      { title: { contains: keyword } },
      { mobile: { contains: keyword } },
      { depts: { some: { department: { name: { contains: keyword } } } } }
    ]
  }
  if (deptId) where.depts = { some: { departmentId: { in: await deptWithDescendants(deptId) } } }
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where, skip, take, orderBy: { id: 'asc' },
      include: { depts: { include: { department: { select: { id: true, name: true } } } } }
    }),
    prisma.user.count({ where })
  ])
  return { list: rows.map(userDto), total }
}

export async function departmentTree(space = {}) {
  const rows = await prisma.department.findMany({
    where: { deletedAt: null, ...space },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { members: true } } }
  })
  const bm = await briefMap(rows.flatMap(r => (Array.isArray(r.leaderIds) ? r.leaderIds : [])))
  const nodes = new Map(rows.map(r => [r.id, {
    id: r.id, name: r.name, parentId: r.parentId, dingDeptId: r.dingDeptId, feishuDeptId: r.feishuDeptId, sort: r.sort, spaceId: r.spaceId,
    leaders: (Array.isArray(r.leaderIds) ? r.leaderIds : []).map(id => bm.get(id)).filter(Boolean),
    memberCount: r._count.members,
    children: []
  }]))
  const roots = []
  for (const n of nodes.values()) {
    if (n.parentId && nodes.has(n.parentId)) nodes.get(n.parentId).children.push(n)
    else roots.push(n)
  }
  return roots
}

/** 某部门及全部下级部门 id */
export async function deptWithDescendants(deptId) {
  const rows = await prisma.department.findMany({ where: { deletedAt: null }, select: { id: true, parentId: true } })
  const out = new Set([Number(deptId)])
  let grew = true
  while (grew) {
    grew = false
    for (const r of rows) {
      if (r.parentId && out.has(r.parentId) && !out.has(r.id)) { out.add(r.id); grew = true }
    }
  }
  return [...out]
}

// ---------- 用户维护(管理员) ----------

export async function createUser(ctx, b) {
  assertAdmin(ctx)
  const name = String(b.name || '').trim()
  if (!name) throw badRequest('姓名必填')
  const username = b.username ? String(b.username).trim() : null
  if (username && !USERNAME.test(username)) throw badRequest('账号需字母开头，只含字母、数字、_ . -，2~50 位')
  if (username && await prisma.user.findUnique({ where: { username } })) throw badRequest(`账号 ${username} 已存在`)
  if (b.password) checkPasswordStrength(b.password)
  const spaceId = b.spaceId ? (await assertSpace(b.spaceId)).id : (ctx.user.spaceId || DEFAULT_SPACE_ID)
  await checkDepts(b.deptIds, spaceId)
  const u = await prisma.user.create({
    data: {
      username, name, spaceId, passwordHash: b.password ? hashPassword(b.password) : null,
      mobile: b.mobile || null, email: b.email || null, title: b.title || null, jobNumber: b.jobNumber || null,
      roles: checkRoles(b.roles || ['MEMBER'])
    }
  })
  if (b.deptIds) await setDepts(u.id, b.deptIds, spaceId)
  audit(ctx, 'user.create', { entityType: 'user', entityId: u.id, detail: { name, username, roles: u.roles, spaceId } })
  return { id: u.id }
}

export async function updateUser(ctx, id, b) {
  assertAdmin(ctx)
  const u = await prisma.user.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!u) throw notFound('用户不存在')
  const d = {}
  for (const k of ['name', 'mobile', 'email', 'title', 'jobNumber']) if (b[k] !== undefined) d[k] = b[k] ? String(b[k]).trim() : null
  if (d.name === null) throw badRequest('姓名不能为空')
  if (b.username !== undefined) {
    const username = b.username ? String(b.username).trim() : null
    if (username && !USERNAME.test(username)) throw badRequest('账号需字母开头，只含字母、数字、_ . -，2~50 位')
    if (username && username !== u.username && await prisma.user.findUnique({ where: { username } })) throw badRequest(`账号 ${username} 已存在`)
    d.username = username
  }
  const losingAdmin = (b.roles !== undefined && !b.roles.includes('ADMIN')) || b.active === false
  if (rolesOf(u).includes('ADMIN') && losingAdmin) {
    if (u.id === ctx.user.id) throw badRequest('不能取消自己的管理员身份或停用自己')
    if (!(await otherAdmins(u.id))) throw badRequest('至少要保留一个可用的管理员')
  }
  if (b.roles !== undefined) d.roles = checkRoles(b.roles)
  if (b.active !== undefined) d.active = !!b.active
  if (b.spaceId !== undefined && Number(b.spaceId) !== u.spaceId) d.spaceId = (await assertSpace(b.spaceId)).id
  const spaceId = d.spaceId || u.spaceId
  if (b.deptIds !== undefined) await checkDepts(b.deptIds, spaceId)
  await prisma.user.update({ where: { id: u.id }, data: d })
  if (b.deptIds !== undefined) await setDepts(u.id, b.deptIds, spaceId)
  else if (d.spaceId) await setDepts(u.id, [], spaceId) // 换了空间又没给新部门：原来空间的部门不能留着
  audit(ctx, 'user.update', { entityType: 'user', entityId: u.id, detail: { ...d, deptIds: b.deptIds } })
  return { ok: true }
}

/** 管理员重置某人密码; password 为空表示取消密码登录 */
export async function setPassword(ctx, id, password) {
  assertAdmin(ctx)
  const u = await prisma.user.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!u) throw notFound('用户不存在')
  if (password) checkPasswordStrength(password)
  if (!password && !u.dingUserId && !u.feishuOpenId && !u.wecomUserId) throw badRequest('该用户没有绑定钉钉 / 飞书 / 企业微信，取消密码后将无法登录')
  if (password && !u.username) throw badRequest('先给该用户设置登录账号')
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: password ? hashPassword(password) : null } })
  audit(ctx, 'user.password.reset', { entityType: 'user', entityId: u.id, detail: { name: u.name, cleared: !password } })
  return { ok: true }
}

export async function deleteUser(ctx, id) {
  assertAdmin(ctx)
  const u = await prisma.user.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!u) throw notFound('用户不存在')
  if (u.id === ctx.user.id) throw badRequest('不能删除自己')
  if (rolesOf(u).includes('ADMIN') && !(await otherAdmins(u.id))) throw badRequest('至少要保留一个可用的管理员')
  // 软删除; 账号、钉钉 / 飞书 / 企业微信绑定释放出来, 以后可以重新建
  await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date(), active: false, username: null, dingUserId: null, unionId: null, feishuOpenId: null, feishuUnionId: null, wecomUserId: null } })
  await prisma.apiKey.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } })
  audit(ctx, 'user.delete', { entityType: 'user', entityId: u.id, detail: { name: u.name, username: u.username } })
  return { ok: true }
}

// ---------- 部门维护(管理员) ----------

export async function createDepartment(ctx, { name, parentId, spaceId }) {
  assertAdmin(ctx)
  if (!String(name || '').trim()) throw badRequest('部门名称必填')
  let sid = spaceId ? (await assertSpace(spaceId)).id : (ctx.user.spaceId || DEFAULT_SPACE_ID)
  if (parentId) {
    const p = await prisma.department.findFirst({ where: { id: Number(parentId), deletedAt: null } })
    if (!p) throw badRequest('上级部门不存在')
    sid = p.spaceId // 下级部门跟上级在同一个空间
  }
  const d = await prisma.department.create({ data: { name: String(name).trim(), parentId: parentId ? Number(parentId) : null, spaceId: sid } })
  audit(ctx, 'department.create', { entityType: 'department', entityId: d.id, detail: { name: d.name } })
  return d
}

export async function updateDepartment(ctx, id, { name, parentId, leaderIds, sort }) {
  assertAdmin(ctx)
  const d = {}
  if (name !== undefined) {
    if (!String(name).trim()) throw badRequest('部门名称不能为空')
    d.name = String(name).trim()
  }
  if (parentId !== undefined) {
    const pid = parentId ? Number(parentId) : null
    if (pid && (await deptWithDescendants(id)).includes(pid)) throw badRequest('不能把部门移到它自己或下级部门下面')
    if (pid) {
      const [self, parent] = await Promise.all([prisma.department.findUnique({ where: { id: Number(id) } }), prisma.department.findUnique({ where: { id: pid } })])
      if (parent && self && parent.spaceId !== self.spaceId) throw badRequest('不能把部门移到别的空间的部门下面')
    }
    d.parentId = pid
  }
  if (leaderIds !== undefined) {
    if (!Array.isArray(leaderIds)) throw badRequest('leaderIds 必须是数组')
    d.leaderIds = leaderIds.map(Number)
  }
  if (sort !== undefined) d.sort = Number(sort) || 0
  const row = await prisma.department.update({ where: { id: Number(id) }, data: d })
  audit(ctx, 'department.update', { entityType: 'department', entityId: row.id, detail: d })
  return { ok: true }
}

export async function deleteDepartment(ctx, id) {
  assertAdmin(ctx)
  const d = await prisma.department.findFirst({ where: { id: Number(id), deletedAt: null } })
  if (!d) throw notFound('部门不存在')
  if (await prisma.department.count({ where: { parentId: d.id, deletedAt: null } })) throw badRequest('先删除或移走下级部门')
  if (await prisma.userDept.count({ where: { departmentId: d.id } })) throw badRequest('部门下还有成员，先把成员调走')
  await prisma.department.update({ where: { id: d.id }, data: { deletedAt: new Date(), dingDeptId: null, feishuDeptId: null } })
  audit(ctx, 'department.delete', { entityType: 'department', entityId: d.id, detail: { name: d.name } })
  return { ok: true }
}

// ---------- 钉钉登录 ----------

/** 钉钉身份 → 用户。没同步过的人首次登录时按钉钉详情建号(可在「登录方式」关掉) */
export async function userFromDingtalk(du) {
  let u = await prisma.user.findFirst({
    where: { deletedAt: null, OR: [{ dingUserId: du.userid }, ...(du.unionId ? [{ unionId: du.unionId }] : [])] }
  })
  if (!u) {
    if (!(await getSetting('login')).autoCreateUser) throw forbidden('你还没有开通账号，请联系管理员')
    u = await upsertFromDing(await ding.getUser(du.userid))
  }
  if (!u.active) throw forbidden('账号已停用，请联系管理员')
  const bootstrap = (await getSetting('dingtalk')).bootstrapAdmins || []
  const roles = rolesOf(u)
  return prisma.user.update({
    where: { id: u.id },
    data: {
      ...(bootstrap.includes(u.dingUserId) && !roles.includes('ADMIN') ? { roles: [...roles, 'ADMIN'] } : {}),
      ...(du.avatarUrl ? { avatar: du.avatarUrl } : {}),
      ...(du.unionId && !u.unionId ? { unionId: du.unionId } : {})
    }
  })
}

/** 按钉钉用户详情新建或更新用户, 并重建部门关系(找不到的部门忽略) */
async function upsertFromDing(d) {
  const data = {
    name: d.name, unionId: d.unionid || null, mobile: d.mobile || null, avatar: d.avatar || null,
    jobNumber: d.job_number || null, title: d.title || null
  }
  const u = await prisma.user.upsert({
    where: { dingUserId: d.userid },
    create: { dingUserId: d.userid, ...data, roles: ['MEMBER'] },
    update: data
  })
  const depts = await prisma.department.findMany({ where: { dingDeptId: { in: (d.dept_id_list || []).map(String) }, deletedAt: null } })
  if (depts.length) await setDepts(u.id, depts.map(x => x.id))
  return u
}

// ---------- 飞书 / 企业微信登录 ----------

const PROVIDERS = {
  feishu: { label: '飞书', field: 'feishuOpenId', setting: 'feishu' },
  wecom: { label: '企业微信', field: 'wecomUserId', setting: 'wecom' }
}

/**
 * 第三方身份 → 用户（飞书 / 企业微信）
 * 对人顺序：已绑定的身份 id（飞书还看 union_id）→ 手机号唯一对上 → 邮箱唯一对上 → 自动建号（可在「登录方式」关掉）
 * 对上已有用户时顺手绑定身份，下次直接认出来
 * ext = { id, unionId?, name, avatar, mobile, email }
 */
export async function userFromProvider(provider, ext) {
  const p = PROVIDERS[provider]
  if (!p || !ext?.id) throw badRequest('不支持的登录方式')
  const where = { deletedAt: null }
  let u = await prisma.user.findFirst({ where: { ...where, [p.field]: ext.id } })
  if (!u && provider === 'feishu' && ext.unionId) u = await prisma.user.findFirst({ where: { ...where, feishuUnionId: ext.unionId } })
  const unique = async (field, value) => {
    if (!value) return null
    const hits = await prisma.user.findMany({ where: { ...where, [field]: value, [p.field]: null }, take: 2 })
    return hits.length === 1 ? hits[0] : null
  }
  if (!u) u = (await unique('mobile', ext.mobile)) || (await unique('email', ext.email))
  if (!u) {
    if (!(await getSetting('login')).autoCreateUser) throw forbidden('你还没有开通账号，请联系管理员')
    u = await prisma.user.create({
      data: { name: ext.name || `${p.label}用户`, avatar: ext.avatar || null, mobile: ext.mobile || null, email: ext.email || null, roles: ['MEMBER'] }
    })
  }
  if (!u.active) throw forbidden('账号已停用，请联系管理员')
  const bootstrap = ((await getSetting(p.setting)).bootstrapAdmins || []).map(String)
  const roles = rolesOf(u)
  const isBootstrap = bootstrap.includes(ext.id) || (ext.mobile && bootstrap.includes(ext.mobile))
  return prisma.user.update({
    where: { id: u.id },
    data: {
      [p.field]: ext.id,
      ...(provider === 'feishu' && ext.unionId && !u.feishuUnionId ? { feishuUnionId: ext.unionId } : {}),
      ...(isBootstrap && !roles.includes('ADMIN') ? { roles: [...roles, 'ADMIN'] } : {}),
      ...(ext.avatar ? { avatar: ext.avatar } : {}),
      ...(!u.mobile && ext.mobile ? { mobile: ext.mobile } : {}),
      ...(!u.email && ext.email ? { email: ext.email } : {})
    }
  })
}

// ---------- 通讯录同步 ----------

/**
 * 从钉钉同步通讯录。dryRun=true 只返回将要做什么, 不写库
 * - 部门以钉钉为准: 按钉钉部门 id 对上, 其次同一上级下的同名本地部门(接上后保留 id 和已配置的可见范围)
 * - 用户: 钉钉 userid → 工号 → 唯一同名且未绑钉钉的本地用户; 都对不上就新建
 * - 钉钉里没有的本地用户不自动停用, 列出来给管理员确认
 */
export async function syncFromDingtalk(ctx, { dryRun = false, spaceId } = {}) {
  const sid = spaceId ? (await assertSpace(spaceId)).id : DEFAULT_SPACE_ID
  assertAdmin(ctx)
  if (!(await ding.configured())) throw badRequest('钉钉未配置，无法同步。请在「管理 → 登录方式」填写钉钉应用凭证')
  const dingDepts = [{ dept_id: 1, name: (await getSetting('general')).companyName || '全员', parent_id: null }, ...(await ding.listAllDepartments())]
  const members = new Map() // userid -> { u, deptIds, leaderOf }
  for (const d of dingDepts) {
    for (const u of await ding.listDeptUsers(d.dept_id)) {
      const m = members.get(u.userid) || { u, deptIds: [], leaderOf: [] }
      if (!m.deptIds.includes(d.dept_id)) m.deptIds.push(d.dept_id)
      if (u.leader && !m.leaderOf.includes(d.dept_id)) m.leaderOf.push(d.dept_id)
      members.set(u.userid, m)
    }
  }
  const localDepts = await prisma.department.findMany({ where: { deletedAt: null } })
  const localUsers = await prisma.user.findMany({ where: { deletedAt: null } })

  // 预先把人对上(不写库), dryRun 和正式同步共用
  const taken = new Set()
  const plan = [...members.values()].map(m => {
    const u = m.u
    let local = localUsers.find(x => x.dingUserId === u.userid)
    if (!local && u.job_number) local = localUsers.find(x => !x.dingUserId && x.jobNumber === u.job_number && !taken.has(x.id))
    if (!local) {
      const hits = localUsers.filter(x => !x.dingUserId && x.name === u.name && !taken.has(x.id))
      if (hits.length === 1) local = hits[0]
    }
    if (local) taken.add(local.id)
    return { m, local }
  })
  const summary = {
    departments: dingDepts.length,
    users: plan.length,
    matched: plan.filter(p => p.local).length,
    created: plan.filter(p => !p.local).map(p => p.m.u.name),
    notInDingtalk: localUsers.filter(x => x.active && !taken.has(x.id) && !x.username).map(x => x.name)
  }
  const msg = (pre) => `${pre}钉钉 ${summary.departments} 个部门、${summary.users} 人；对上现有用户 ${summary.matched} 人` +
    (summary.created.length ? `；新建 ${summary.created.length} 人` : '') +
    (summary.notInDingtalk.length ? `；${summary.notInDingtalk.length} 人钉钉里没有（未停用，请确认）` : '')
  if (dryRun) return { dryRun: true, ...summary, message: msg('预览：') }

  // 部门: 父部门先有本地 id
  const idOf = new Map()
  const pending = [...dingDepts]
  while (pending.length) {
    const i = Math.max(0, pending.findIndex(d => d.parent_id === null || idOf.has(d.parent_id)))
    const d = pending.splice(i, 1)[0]
    const parentId = d.parent_id ? idOf.get(d.parent_id) ?? null : null
    let local = localDepts.find(x => x.dingDeptId === String(d.dept_id)) ||
      localDepts.find(x => !x.dingDeptId && x.name === d.name && x.parentId === parentId)
    local = local
      ? await prisma.department.update({ where: { id: local.id }, data: { name: d.name, parentId, dingDeptId: String(d.dept_id) } })
      : await prisma.department.create({ data: { name: d.name, parentId, dingDeptId: String(d.dept_id), spaceId: sid } })
    idOf.set(d.dept_id, local.id)
  }
  const leaders = new Map()
  for (const { m, local } of plan) {
    const u = m.u
    const data = {
      dingUserId: u.userid, unionId: u.unionid || null, name: u.name, avatar: u.avatar || null,
      title: u.title || local?.title || null, jobNumber: u.job_number || local?.jobNumber || null,
      mobile: u.mobile || local?.mobile || null
    }
    const row = local
      ? await prisma.user.update({ where: { id: local.id }, data })
      : await prisma.user.create({ data: { ...data, roles: ['MEMBER'], spaceId: sid } })
    await setDepts(row.id, m.deptIds.map(id => idOf.get(id)))
    for (const d of m.leaderOf) leaders.set(idOf.get(d), [...(leaders.get(idOf.get(d)) || []), row.id])
  }
  for (const [deptId, ids] of leaders) await prisma.department.update({ where: { id: deptId }, data: { leaderIds: [...new Set(ids)] } })
  audit(ctx, 'org.sync', { detail: { ...summary, created: summary.created.length, notInDingtalk: summary.notInDingtalk.length } })
  return { dryRun: false, ...summary, message: msg('已同步：') }
}

// ---------- 飞书通讯录同步 ----------

/**
 * 从飞书同步通讯录，逻辑与钉钉同步对齐。dryRun=true 只返回将要做什么, 不写库
 * - 部门以飞书为准: 按飞书 open_department_id 对上, 其次同一上级下的同名本地部门(接上后保留 id 和已配置的可见范围)
 * - 用户: 飞书 open_id → union_id → 工号 → 唯一同名且未绑飞书的本地用户; 都对不上就新建
 * - 飞书里没有的本地用户不自动停用, 列出来给管理员确认
 */
export async function syncFromFeishu(ctx, { dryRun = false, spaceId } = {}) {
  const sid = spaceId ? (await assertSpace(spaceId)).id : DEFAULT_SPACE_ID
  assertAdmin(ctx)
  if (!(await feishu.configured())) throw badRequest('飞书未配置，无法同步。请在「管理 → 登录方式」填写飞书应用凭证')
  const fsDepts = [{ deptId: '0', name: (await getSetting('general')).companyName || '全员', parentId: null }, ...(await feishu.listAllDepartments())]
  const members = new Map() // openId -> { u, deptIds }
  const leads = new Map() // 上级的 openId -> Set(其下属所在部门 id)
  for (const d of fsDepts) {
    for (const u of await feishu.listDeptUsers(d.deptId)) {
      const m = members.get(u.openId) || { u, deptIds: [] }
      if (!m.deptIds.includes(d.deptId)) m.deptIds.push(d.deptId)
      members.set(u.openId, m)
      if (u.leaderUserId) {
        const set = leads.get(u.leaderUserId) || new Set()
        set.add(d.deptId)
        leads.set(u.leaderUserId, set)
      }
    }
  }
  const localDepts = await prisma.department.findMany({ where: { deletedAt: null } })
  const localUsers = await prisma.user.findMany({ where: { deletedAt: null } })

  // 预先将人对上(不写库), dryRun 和正式同步共用
  const taken = new Set()
  const plan = [...members.values()].map(m => {
    const u = m.u
    let local = localUsers.find(x => x.feishuOpenId === u.openId)
    if (!local && u.unionId) local = localUsers.find(x => x.feishuUnionId === u.unionId && !taken.has(x.id))
    if (!local && u.jobNumber) local = localUsers.find(x => !x.feishuOpenId && x.jobNumber === u.jobNumber && !taken.has(x.id))
    if (!local) {
      const hits = localUsers.filter(x => !x.feishuOpenId && x.name === u.name && !taken.has(x.id))
      if (hits.length === 1) local = hits[0]
    }
    if (local) taken.add(local.id)
    return { m, local }
  })
  const summary = {
    departments: fsDepts.length,
    users: plan.length,
    matched: plan.filter(p => p.local).length,
    created: plan.filter(p => !p.local).map(p => p.m.u.name),
    notInFeishu: localUsers.filter(x => x.active && !taken.has(x.id) && !x.username).map(x => x.name)
  }
  const msg = (pre) => `${pre}飞书 ${summary.departments} 个部门、${summary.users} 人；对上现有用户 ${summary.matched} 人` +
    (summary.created.length ? `；新建 ${summary.created.length} 人` : '') +
    (summary.notInFeishu.length ? `；${summary.notInFeishu.length} 人飞书里没有（未停用，请确认）` : '')
  if (dryRun) return { dryRun: true, ...summary, message: msg('预览：') }

  // 部门: 父部门先有本地 id
  const idOf = new Map()
  const pending = [...fsDepts]
  while (pending.length) {
    const i = Math.max(0, pending.findIndex(d => d.parentId === null || idOf.has(d.parentId)))
    const d = pending.splice(i, 1)[0]
    const parentId = d.parentId ? idOf.get(d.parentId) ?? null : null
    let local = localDepts.find(x => x.feishuDeptId === d.deptId) ||
      localDepts.find(x => !x.feishuDeptId && !x.dingDeptId && x.name === d.name && x.parentId === parentId)
    local = local
      ? await prisma.department.update({ where: { id: local.id }, data: { name: d.name, parentId, feishuDeptId: d.deptId } })
      : await prisma.department.create({ data: { name: d.name, parentId, feishuDeptId: d.deptId, spaceId: sid } })
    idOf.set(d.deptId, local.id)
  }
  const byOpenId = new Map()
  for (const { m, local } of plan) {
    const u = m.u
    const data = {
      feishuOpenId: u.openId, feishuUnionId: u.unionId || null, name: u.name, avatar: u.avatar || local?.avatar || null,
      title: u.title || local?.title || null, jobNumber: u.jobNumber || local?.jobNumber || null,
      mobile: u.mobile || local?.mobile || null, email: u.email || local?.email || null
    }
    const row = local
      ? await prisma.user.update({ where: { id: local.id }, data })
      : await prisma.user.create({ data: { ...data, roles: ['MEMBER'], spaceId: sid } })
    byOpenId.set(u.openId, row)
    await setDepts(row.id, m.deptIds.map(id => idOf.get(id)).filter(Boolean))
  }
  // 部门负责人: 有下属的人就是该部门的负责人
  const leaders = new Map()
  for (const [leaderOpenId, deptIds] of leads) {
    const leadRow = byOpenId.get(leaderOpenId)
    if (!leadRow) continue
    for (const d of deptIds) {
      const lid = idOf.get(d)
      if (lid) leaders.set(lid, [...(leaders.get(lid) || []), leadRow.id])
    }
  }
  for (const [deptId, ids] of leaders) await prisma.department.update({ where: { id: deptId }, data: { leaderIds: [...new Set(ids)] } })
  audit(ctx, 'org.sync', { detail: { provider: 'feishu', ...summary, created: summary.created.length, notInFeishu: summary.notInFeishu.length } })
  return { dryRun: false, ...summary, message: msg('已同步：') }
}

// ---------- 用户主数据(开放给接入应用) ----------

/** 各应用以此为准对人, 不再各自维护一份花名册。updatedSince: 增量同步 */
/** 用户主数据（给应用）。spaceIds：应用能在哪些空间用，只给这些空间的人和部门（apps 的 spacesOfApp） */
export async function masterUsers({ updatedSince, includeInactive, spaceIds } = {}) {
  const inSpaces = spaceIds ? { spaceId: { in: spaceIds } } : {}
  const where = { deletedAt: null, ...inSpaces, ...(includeInactive === 'true' ? {} : { active: true }) }
  if (updatedSince) {
    const t = new Date(updatedSince)
    if (Number.isNaN(t.getTime())) throw badRequest('updatedSince 不是有效时间')
    where.updatedAt = { gte: t }
  }
  const [rows, depts] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { id: 'asc' }, include: { depts: true } }),
    prisma.department.findMany({ where: { deletedAt: null, ...inSpaces }, select: { id: true, name: true, parentId: true } })
  ])
  const byId = new Map(depts.map(d => [d.id, d]))
  const pathOf = (id) => {
    const names = []
    for (let d = byId.get(id), n = 0; d && n < 10; d = byId.get(d.parentId), n++) names.unshift(d.name)
    return names.join('/')
  }
  return {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    list: rows.map(u => ({
      id: u.id, username: u.username, name: u.name, jobNumber: u.jobNumber || null, title: u.title || null,
      mobile: u.mobile || null, email: u.email || null, active: u.active, dingUserId: u.dingUserId,
      feishuOpenId: u.feishuOpenId || null, wecomUserId: u.wecomUserId || null, spaceId: u.spaceId,
      depts: u.depts.map(d => ({ id: d.departmentId, name: byId.get(d.departmentId)?.name, path: pathOf(d.departmentId), isPrimary: d.isPrimary })),
      updatedAt: u.updatedAt
    }))
  }
}
