// 读表格：CSV、从 Excel 复制粘贴的文本（制表符分隔）、.xlsx 文件 → 二维数组（第一行是表头）
// 只读第一个工作表的单元格文字，够导人员名单用；不认公式、合并单元格
import { unzipSync, strFromU8 } from 'fflate'

/** CSV / TSV 文本 → 二维数组。认引号里的逗号、换行和 "" 转义；有制表符就按制表符分 */
export function parseDelimited(text) {
  const s = String(text || '').replace(/^﻿/, '')
  const sep = s.split('\n', 1)[0].includes('\t') ? '\t' : ','
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(x => String(x).trim()))
}

const colIndex = ref => {
  let n = 0
  for (const ch of String(ref).replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** .xlsx（ArrayBuffer）→ 二维数组 */
export function parseXlsx(buf) {
  const files = unzipSync(new Uint8Array(buf))
  const xml = name => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml') : null)
  const shared = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') || [])].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join(''))
  const sheetName = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))[0]
  if (!sheetName) throw new Error('文件里没有工作表')
  const rows = []
  for (const r of xml(sheetName).getElementsByTagName('row')) {
    const row = []
    for (const c of r.getElementsByTagName('c')) {
      const t = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
      const text = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : v
      row[colIndex(c.getAttribute('r'))] = text
    }
    rows.push(Array.from(row, x => x ?? ''))
  }
  return rows.filter(r => r.some(x => String(x).trim()))
}

/** 选中的文件 → 二维数组 */
export async function readTableFile(file) {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer())
  if (/\.xls$/i.test(file.name)) throw new Error('不支持老的 .xls，请在 Excel 里另存为 .xlsx 或 CSV')
  const buf = await file.arrayBuffer()
  // Excel 存的 CSV 在中文 Windows 上常是 GBK：UTF-8 解出乱码字符时换 GBK 再解
  let text = new TextDecoder('utf-8').decode(buf)
  if (text.includes('�')) { try { text = new TextDecoder('gbk').decode(buf) } catch { /* 浏览器不支持 gbk 就算了 */ } }
  return parseDelimited(text)
}

/** 下载一份 CSV（带 BOM，Excel 打开不乱码） */
export function downloadCsv(name, rows) {
  const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
