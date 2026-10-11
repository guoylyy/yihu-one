// Skill 文件：浏览器里把 ZIP / 文件夹读成 [{ path, data(base64) }]，或反过来打成 ZIP 下载
// 平台后端会再校验一遍（路径、可执行文件、大小），这里只做读取和提示
import { unzipSync, zipSync } from 'fflate'

const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX(\/.*)?|\.git(\/.*)?)$/

function toBase64(u8) {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromBase64(b64) {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

/** 只有一个顶层文件夹、SKILL.md 在它下面时（打包时连文件夹一起打的），去掉这层 */
function stripCommonRoot(entries) {
  if (entries.some(e => e.path === 'SKILL.md')) return entries
  const roots = new Set(entries.map(e => e.path.split('/')[0]))
  if (roots.size !== 1) return entries
  const root = [...roots][0]
  if (!entries.some(e => e.path === `${root}/SKILL.md`)) return entries
  return entries.map(e => ({ ...e, path: e.path.slice(root.length + 1) })).filter(e => e.path)
}

function finish(entries) {
  return stripCommonRoot(entries.filter(e => e.path && !e.path.endsWith('/') && !IGNORED.test(e.path)))
    .map(e => ({ path: e.path, data: toBase64(e.bytes), size: e.bytes.length }))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
}

export async function readZip(file) {
  const u8 = new Uint8Array(await file.arrayBuffer())
  const out = unzipSync(u8)
  return finish(Object.entries(out).map(([path, bytes]) => ({ path, bytes })))
}

/** <input webkitdirectory> 选的文件夹：webkitRelativePath 带着文件夹名 */
export async function readFolder(fileList) {
  const entries = []
  for (const f of fileList) entries.push({ path: f.webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
  return finish(entries)
}

export function textOf(file) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(file.data)) } catch { return null }
}

/** 浏览器里简单读一下 SKILL.md 的 name / description，给用户即时提示（以后端校验为准） */
export function skillMeta(files) {
  const entry = files.find(f => f.path === 'SKILL.md')
  if (!entry) return null
  const t = textOf(entry) || ''
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t.replace(/^﻿/, ''))
  const meta = { body: m ? t.slice(m[0].length).trim() : t }
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return meta
}

export function downloadZip(name, files) {
  const tree = {}
  for (const f of files) tree[`${name}/${f.path}`] = fromBase64(f.data)
  const blob = new Blob([zipSync(tree)], { type: 'application/zip' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name}.zip`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const formatSize = n => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`)
