// 平台级知识库: 知识库与文档的维护、可见范围判定、检索(RAG)
// 知识库是平台级能力, 不分应用; 谁能看到 / 搜到按 scope:
//   ALL 全员 / DEPT 指定部门(含其成员)/ ADMIN 仅管理员
// 文档的解析切分向量化见 kbdoc.js; 检索见本文件 search()
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin } from '../lib/auth.js'
import { badRequest } from '../lib/http.js'
import { assertSpace } from './spaces.js'

const SCOPES = new Set(['ALL', 'DEPT', 'ADMIN'])

function cleanDeptIds(ids) {
  const out = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))]
  return out
}

/** 用户能否看到某个知识库。ADMIN 范围只放行管理员 */
export function canSee(user, kb) {
  if (user.roles?.includes('ADMIN')) return true
  if ((kb.spaceId ?? 1) !== (user.spaceId ?? 1)) return false // 别的空间的知识库看不到
  if (kb.scope === 'ALL') return true
  if (kb.scope === 'ADMIN') return false
  if (kb.scope === 'DEPT') {
    const ids = new Set((Array.isArray(kb.deptIds) ? kb.deptIds : []).map(Number))
    return user.deptIds?.some(d => ids.has(d))
  }
  return false
}

/** 用户可见的知识库列表(列表页 + 检索过滤都用)。enabled 只对非管理员生效 */
export async function visibleKbList(user) {
  const rows = await prisma.knowledgeBase.findMany({
    where: user.roles?.includes('ADMIN') ? {} : { enabled: true },
    orderBy: [{ id: 'asc' }],
    include: { _count: { select: { documents: true } } }
  })
  return rows.filter(kb => canSee(user, kb)).map(kb => ({
    id: kb.id, name: kb.name, description: kb.description, scope: kb.scope, deptIds: kb.deptIds || [],
    enabled: kb.enabled, docCount: kb._count.documents,
    readyDocs: undefined // 状态统计在文档接口取
  }))
}

// ---------- 管理(管理员) ----------

function kbDto(kb, docCount) {
  return {
    id: kb.id, name: kb.name, description: kb.description, scope: kb.scope,
    deptIds: kb.deptIds || [], enabled: kb.enabled, docCount, spaceId: kb.spaceId ?? 1
  }
}

export async function listForAdmin() {
  const rows = await prisma.knowledgeBase.findMany({
    orderBy: [{ id: 'asc' }],
    include: { _count: { select: { documents: true } } }
  })
  return rows.map(kb => kbDto(kb, kb._count.documents))
}

export async function createKb(ctx, b) {
  assertAdmin(ctx)
  const name = String(b.name || '').trim()
  if (!name) throw badRequest('知识库名称必填')
  const scope = SCOPES.has(b.scope) ? b.scope : 'ALL'
  const deptIds = scope === 'DEPT' ? cleanDeptIds(b.deptIds) : []
  if (scope === 'DEPT' && !deptIds.length) throw badRequest('按部门可见时，至少要选一个部门')
  const kb = await prisma.knowledgeBase.create({
    data: {
      name, description: b.description ? String(b.description).slice(0, 500) : null,
      scope, deptIds: scope === 'DEPT' ? deptIds : null, enabled: b.enabled !== false,
      spaceId: b.spaceId ? (await assertSpace(b.spaceId)).id : (ctx.user.spaceId || 1)
    }
  })
  audit(ctx, 'kb.create', { entityType: 'knowledge_base', entityId: kb.id, detail: { name, scope } })
  return { id: kb.id }
}

export async function updateKb(ctx, id, b) {
  assertAdmin(ctx)
  const kb = await prisma.knowledgeBase.findUnique({ where: { id: Number(id) } })
  if (!kb) throw badRequest('知识库不存在')
  const d = {}
  if (b.name !== undefined) {
    const name = String(b.name).trim()
    if (!name) throw badRequest('名称不能为空')
    d.name = name
  }
  if (b.description !== undefined) d.description = b.description ? String(b.description).slice(0, 500) : null
  if (b.enabled !== undefined) d.enabled = !!b.enabled
  if (b.spaceId !== undefined) d.spaceId = (await assertSpace(b.spaceId)).id
  let scope = kb.scope
  if (b.scope !== undefined) {
    if (!SCOPES.has(b.scope)) throw badRequest(`scope 只能是 ${[...SCOPES].join(' / ')}`)
    scope = b.scope
    d.scope = scope
  }
  if (b.deptIds !== undefined || (d.scope && scope === 'DEPT')) {
    const ids = cleanDeptIds(b.deptIds ?? kb.deptIds)
    if (scope === 'DEPT' && !ids.length) throw badRequest('按部门可见时，至少要选一个部门')
    d.deptIds = scope === 'DEPT' ? ids : null
  }
  await prisma.knowledgeBase.update({ where: { id: kb.id }, data: d })
  audit(ctx, 'kb.update', { entityType: 'knowledge_base', entityId: kb.id, detail: { ...d } })
  return { ok: true }
}

/** 删除知识库: 文档与片段随级联一并删除 */
export async function deleteKb(ctx, id) {
  assertAdmin(ctx)
  const kb = await prisma.knowledgeBase.findUnique({ where: { id: Number(id) } })
  if (!kb) throw badRequest('知识库不存在')
  await prisma.knowledgeBase.delete({ where: { id: kb.id } })
  audit(ctx, 'kb.delete', { entityType: 'knowledge_base', entityId: kb.id, detail: { name: kb.name } })
  return { ok: true }
}

// ---------- 检索(RAG) ----------

/** 余弦相似度。两向量等长时直接点积/模积 */
export function cosine(a, b) {
  if (!a?.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * 中文 n-gram 短词。去空白/标点后按 2 字切(英文按小写词)。
 * 用来在 SQL 里做粗过滤(只保留含任一查询短词的片段), 避免把全部片段拉进内存
 */
export function queryTerms(query) {
  const out = new Set()
  const text = String(query || '').toLowerCase()
  for (const w of text.match(/[a-z0-9]+/g) || []) if (w.length >= 2) out.add(w)
  const cjk = (text.match(/[一-鿿]/g) || []).join('')
  for (let i = 0; i + 2 <= cjk.length; i++) out.add(cjk.slice(i, i + 2))
  return [...out]
}

/**
 * 检索企业知识。
 * 1) query 向量化; 2) 只取用户可见且启用的知识库; 3) 关键词(正文/文档名 LIKE)粗过滤候选;
 * 4) JS 余弦重排 topK; 关键词一个没命中时, 退回取该范围最近一批片段(限量)再重排
 * 返回 [{ kbId, kbName, documentId, docName, content, score }]
 */
export async function searchKnowledge(user, query, { topK = 5, kbId = null } = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  // 延迟引入避免循环依赖
  const { embed } = await import('../agent/llm.js')
  const [qv] = await embed([q])

  const kbs = (await visibleKbList(user)).filter(kb => (kbId ? kb.id === Number(kbId) : true))
  if (!kbs.length) return []
  const kbIds = kbs.map(kb => kb.id)
  const kbNameOf = new Map(kbs.map(kb => [kb.id, kb.name]))

  const terms = queryTerms(q)
  // SQL 粗过滤: 片段正文含任一短词, 或文档名含整段查询里的词
  let candidates
  if (terms.length) {
    const cond = terms.slice(0, 40).map(() => 'c.content LIKE ?').join(' OR ')
    const params = terms.slice(0, 40).map(t => `%${t}%`)
    const rows = await prisma.$queryRawUnsafe(
      `SELECT c.id, c.content, c.embedding, c.documentId AS documentId, c.kbId AS kbId, d.name AS docName
       FROM KbChunk c JOIN KbDocument d ON d.id = c.documentId
       WHERE c.kbId IN (${kbIds.map(() => '?').join(',')}) AND (${cond}) LIMIT 2000`,
      ...kbIds, ...params
    )
    candidates = rows
  } else {
    candidates = []
  }

  // 关键词零命中: 退回该范围下取一批片段(文档 READY), 纯靠向量近邻
  if (!candidates.length) {
    candidates = await prisma.$queryRawUnsafe(
      `SELECT c.id, c.content, c.embedding, c.documentId AS documentId, c.kbId AS kbId, d.name AS docName
       FROM KbChunk c JOIN KbDocument d ON d.id = c.documentId
       WHERE c.kbId IN (${kbIds.map(() => '?').join(',')}) AND d.status = 'READY' LIMIT 2000`,
      ...kbIds
    )
  }

  const scored = candidates.map(c => ({
    kbId: c.kbId, kbName: kbNameOf.get(c.kbId), documentId: c.documentId, docName: c.docName,
    content: c.content, score: cosine(qv, Array.isArray(c.embedding) ? c.embedding : JSON.parse(c.embedding))
  })).filter(r => r.score > 0)

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
