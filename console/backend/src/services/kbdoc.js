// 知识库文档: 上传 → 解析 → 中文友好切分 → 批量向量化 → 写片段
// 文档处理在 console 进程内异步跑(不经过 yh/Docker): 一个文档一个处理锁, 状态机 PENDING/PROCESSING/READY/FAILED
import { Buffer } from 'node:buffer'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { assertAdmin } from '../lib/auth.js'
import { badRequest } from '../lib/http.js'
import { embed } from '../agent/llm.js'

const TARGET_CHARS = 500 // 每片目标字数
const OVERLAP_CHARS = 80 // 相邻片重叠, 避免句子被切断后语义丢失
const MAX_CHARS = 200_000 // 单文档上限, 防止超长文档刷爆 embedding

// ---------- 解析 ----------

/** 原始文件 → 纯文本 */
export async function extractText(fileType, buf) {
  if (fileType === 'TXT' || fileType === 'MD') {
    return buf.toString('utf8')
  }
  if (fileType === 'PDF') {
    let parser
    try {
      parser = new PDFParse({ data: buf })
      const r = await parser.getText()
      return r.text
    } finally {
      await parser?.destroy?.().catch(() => {})
    }
  }
  if (fileType === 'DOCX') {
    const r = await mammoth.extractRawText({ buffer: buf })
    return r.value
  }
  throw badRequest(`不支持的文件类型 ${fileType}`)
}

// ---------- 切分 ----------

/**
 * 中文友好切分。先按段落(空行)分块, 段落过长再按句号/问号/感叹号/分号断句;
 * 尽量凑到 TARGET_CHARS; 每片从上个片段末尾带 OVERLAP_CHARS 重叠
 */
export function chunkText(raw) {
  const text = normalize(raw)
  if (!text) return []
  const paras = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)

  // 段落 → 句子(过长的段落); 普通段落整段保留
  const units = []
  for (const para of paras) {
    if (para.length <= TARGET_CHARS) { units.push(para); continue }
    const sentences = para.split(/(?<=[。！？!?；;\n])/).map(s => s.trim()).filter(Boolean)
    for (const s of sentences) {
      if (s.length <= TARGET_CHARS) units.push(s)
      else for (const piece of hardSplit(s, TARGET_CHARS)) units.push(piece)
    }
  }

  // 句子/段落 → 凑片
  const chunks = []
  let cur = ''
  const pushCur = () => { if (cur.trim()) chunks.push(cur.trim()); cur = '' }
  for (const u of units) {
    if (cur && (cur.length + u.length + 1) > TARGET_CHARS) pushCur()
    cur = cur ? `${cur}\n${u}` : u
    if (cur.length >= TARGET_CHARS) pushCur()
  }
  pushCur()
  return addOverlap(chunks)
}

/** 超长且无标点的内容, 硬切 */
function hardSplit(s, size) {
  const out = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}

/** 相邻片段加重叠: 下一片开头带上一片结尾的 OVERLAP_CHARS */
function addOverlap(chunks) {
  if (chunks.length < 2) return chunks
  const out = [chunks[0]]
  for (let i = 1; i < chunks.length; i++) {
    const tail = chunks[i - 1].slice(-OVERLAP_CHARS)
    out.push(`${tail}${chunks[i].startsWith(tail) ? '' : chunks[i]}`)
  }
  return out
}

function normalize(raw) {
  return String(raw || '')
    .replace(/[\r\f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---------- 处理(异步) ----------

const processing = new Set() // 正在处理的文档 id, 防重入

/** 处理一个文档: 解析 → 切分 → embedding → 写 KbChunk, 全程更新状态 */
export async function processDocument(docId) {
  if (processing.has(docId)) return
  processing.add(docId)
  try {
    const doc = await prisma.kbDocument.findUnique({ where: { id: docId } })
    if (!doc) return
    await prisma.kbDocument.update({ where: { id: docId }, data: { status: 'PROCESSING', error: null } })

    const text = await extractText(doc.fileType, Buffer.from(doc.content))
    const clean = normalize(text)
    if (!clean) throw new Error('文档里没有可提取的文字（可能是扫描件/图片型 PDF，v1 暂不支持）')
    if (clean.length > MAX_CHARS) throw new Error(`文档太长（${clean.length} 字，上限 ${MAX_CHARS}），请拆分成多个文档`)

    const chunks = chunkText(clean)
    if (!chunks.length) throw new Error('切分后没有内容')

    // 清掉旧片段(重处理时), 再批量向量化
    await prisma.kbChunk.deleteMany({ where: { documentId: docId } })
    const vectors = await embed(chunks)
    const rows = chunks.map((c, i) => ({
      documentId: docId, kbId: doc.kbId, ord: i, content: c, embedding: vectors[i] || []
    })).filter(r => Array.isArray(r.embedding) && r.embedding.length)

    await prisma.kbChunk.createMany({ data: rows })
    await prisma.kbDocument.update({
      where: { id: docId },
      data: { status: 'READY', chunkCount: rows.length, error: null }
    })
  } catch (e) {
    await prisma.kbDocument.update({
      where: { id: docId },
      data: { status: 'FAILED', error: String(e.message || e).slice(0, 480) }
    })
  } finally {
    processing.delete(docId)
  }
}

// ---------- 后台队列(进程内) ----------

/** 每 N 秒扫一次 PENDING/遗留的文档并处理; 串行, 一个一个来 */
export function startKbWorker({ intervalMs = 15_000 } = {}) {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const pending = await prisma.kbDocument.findMany({
        where: { status: { in: ['PENDING'] } },
        orderBy: { id: 'asc' },
        take: 1
      })
      if (pending[0]) await processDocument(pending[0].id)
    } catch {
      // 扫描异常不致命, 下一轮再来
    }
    if (!stopped) setTimeout(tick, intervalMs)
  }
  setTimeout(tick, intervalMs)
  return () => { stopped = true }
}

// ---------- 文档维护(管理员) ----------

const FILE_TYPES = {
  pdf: 'PDF', docx: 'DOCX', txt: 'TXT', md: 'MD', markdown: 'MD'
}

export function fileTypeOf(filename) {
  const ext = String(filename).split('.').pop()?.toLowerCase() || ''
  return FILE_TYPES[ext] || null
}

export function docDto(doc) {
  return {
    id: doc.id, kbId: doc.kbId, name: doc.name, fileType: doc.fileType, size: doc.size,
    status: doc.status, error: doc.error, chunkCount: doc.chunkCount,
    createdAt: doc.createdAt, updatedAt: doc.updatedAt
  }
}

/** 列出某知识库下的文档(不含原文件) */
export async function listDocuments(kbId) {
  const rows = await prisma.kbDocument.findMany({
    where: { kbId: Number(kbId) },
    orderBy: { id: 'desc' }
  })
  return rows.map(docDto)
}

/**
 * 管理员上传文档(单个)。content 已是文件 Buffer。
 * 建文档即 PENDING, 后台 worker 自动拉起处理
 */
export async function uploadDocument(ctx, kbId, { name, content }) {
  assertAdmin(ctx)
  const kb = await prisma.knowledgeBase.findUnique({ where: { id: Number(kbId) } })
  if (!kb) throw badRequest('知识库不存在')
  const fileType = fileTypeOf(name)
  if (!fileType) throw badRequest('只支持 PDF / Word(docx) / TXT / Markdown 文件')
  if (!Buffer.isBuffer(content) || !content.length) throw badRequest('文件内容为空')
  const doc = await prisma.kbDocument.create({
    data: { kbId: kb.id, name: String(name).slice(0, 200), fileType, size: content.length, content, status: 'PENDING' }
  })
  audit(ctx, 'kb.doc.upload', { entityType: 'kb_document', entityId: doc.id, detail: { kbId: kb.id, name: doc.name } })
  // 不等处理完, 让 worker 异步做; 但立刻起一次处理, 省得等轮询
  void processDocument(doc.id)
  return { id: doc.id }
}

/** 手动重处理(FAILED 后或文件更新后) */
export async function reprocess(ctx, docId) {
  assertAdmin(ctx)
  const doc = await prisma.kbDocument.findUnique({ where: { id: Number(docId) } })
  if (!doc) throw badRequest('文档不存在')
  await prisma.kbDocument.update({ where: { id: doc.id }, data: { status: 'PENDING', error: null } })
  void processDocument(doc.id)
  return { ok: true }
}

/** 删除文档: 片段级联删除 */
export async function deleteDocument(ctx, docId) {
  assertAdmin(ctx)
  const doc = await prisma.kbDocument.findUnique({ where: { id: Number(docId) } })
  if (!doc) throw badRequest('文档不存在')
  await prisma.kbDocument.delete({ where: { id: doc.id } })
  audit(ctx, 'kb.doc.delete', { entityType: 'kb_document', entityId: doc.id, detail: { name: doc.name } })
  return { ok: true }
}
