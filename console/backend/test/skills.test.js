// Skill 内容校验：上传的文件是不可信输入（路径穿越、可执行文件、超量都要拦），SKILL.md frontmatter、内容指纹
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { normalizeSkillPayload, safePath, parseFrontmatter, digestOf, LIMITS } = await import('../src/services/skills.js')
const { normalizePayload, KINDS } = await import('../src/services/studio.js')

const SKILL_MD = '---\nname: weekly-report\ndescription: 按公司模板写周报。用户说「写周报」时使用\nversion: 1.2.0\n---\n\n# 周报\n'
const text = (path, content) => ({ path, content })
const b64 = (path, buf) => ({ path, data: Buffer.from(buf).toString('base64') })

test('Skill 是第五种应用类型，内容校验走 studio 的同一个入口', () => {
  assert.ok(KINDS.includes('SKILL'))
  const p = normalizePayload('SKILL', { files: [text('SKILL.md', SKILL_MD)] }, true)
  assert.equal(p.name, 'weekly-report')
})

test('frontmatter：读 name / description / version，带引号也行', () => {
  assert.deepEqual(parseFrontmatter(SKILL_MD), { name: 'weekly-report', description: '按公司模板写周报。用户说「写周报」时使用', version: '1.2.0' })
  assert.equal(parseFrontmatter('---\nname: "a-b"\n---').name, 'a-b')
  assert.deepEqual(parseFrontmatter('# 没有 frontmatter'), {})
})

test('正常的 Skill：文件按路径排好，带大小和指纹', () => {
  const p = normalizeSkillPayload({ files: [text('scripts/run.py', 'print(1)\n'), text('SKILL.md', SKILL_MD)] }, true)
  assert.deepEqual(p.files.map(f => f.path), ['SKILL.md', 'scripts/run.py'])
  assert.equal(p.files[1].size, 9)
  assert.equal(p.version, '1.2.0')
  assert.match(p.digest, /^[0-9a-f]{16}$/)
})

test('指纹：内容一样顺序不同 → 一样；改一个字 → 不一样', () => {
  const a = normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), text('a.txt', 'x')] })
  const b = normalizeSkillPayload({ files: [text('a.txt', 'x'), text('SKILL.md', SKILL_MD)] })
  const c = normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), text('a.txt', 'y')] })
  assert.equal(a.digest, b.digest)
  assert.notEqual(a.digest, c.digest)
  assert.equal(digestOf(a.files), a.digest)
})

test('路径：穿越、绝对路径、Windows 盘符、空段都拦；反斜杠和 ./ 规范化', () => {
  for (const bad of ['../etc/passwd', 'a/../../b', '/etc/passwd', 'C:/x', 'a//b', '.', '']) assert.equal(safePath(bad), null, bad)
  assert.equal(safePath('scripts\\run.py'), 'scripts/run.py')
  assert.equal(safePath('./SKILL.md'), 'SKILL.md')
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), text('../x', 'x')] }), /路径不合法/)
})

test('可执行文件：按扩展名和文件头都拦，脚本可以', () => {
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), b64('tool.exe', 'whatever')] }), /可执行文件/)
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), b64('tool', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2]))] }), /可执行文件/, 'ELF 改了名也拦')
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), b64('x.dat', 'MZ\x90\x00')] }), /可执行文件/, 'Windows PE')
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), b64('x', Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))] }), /可执行文件/, 'Mach-O')
  assert.doesNotThrow(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), text('run.sh', '#!/bin/sh\necho hi\n')] }))
})

test('系统垃圾文件（.DS_Store、__MACOSX、.git）直接丢掉', () => {
  const p = normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), text('.DS_Store', 'x'), text('__MACOSX/._SKILL.md', 'x'), text('.git/config', 'x')] })
  assert.deepEqual(p.files.map(f => f.path), ['SKILL.md'])
})

test('数量和大小有上限', () => {
  const many = Array.from({ length: LIMITS.files + 1 }, (_, i) => text(`f${i}.txt`, 'x'))
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), ...many] }), /文件太多/)
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), text('big.txt', 'x'.repeat(LIMITS.fileBytes + 1))] }), /文件太大/)
  const halves = [1, 2, 3].map(i => text(`p${i}.txt`, 'x'.repeat(LIMITS.fileBytes - 10)))
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD), ...halves] }), /Skill 太大/)
})

test('提交时：必须有 SKILL.md，name 合规，description 必填；存草稿时不强求', () => {
  assert.doesNotThrow(() => normalizeSkillPayload({ files: [text('README.md', 'x')] }, false))
  assert.throws(() => normalizeSkillPayload({ files: [text('README.md', 'x')] }, true), /缺少 SKILL\.md/)
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', '---\nname: Weekly Report\ndescription: x\n---')] }, true), /name/)
  assert.throws(() => normalizeSkillPayload({ files: [text('SKILL.md', '---\nname: weekly\n---')] }, true), /description/)
})

test('MCP 传的 base64 内容和网页传的 data 结果一致', () => {
  const a = normalizeSkillPayload({ files: [text('SKILL.md', SKILL_MD)] })
  const b = normalizeSkillPayload({ files: [{ path: 'SKILL.md', content: Buffer.from(SKILL_MD).toString('base64'), encoding: 'base64' }] })
  const c = normalizeSkillPayload({ files: [b64('SKILL.md', SKILL_MD)] })
  assert.equal(a.digest, b.digest)
  assert.equal(a.digest, c.digest)
})
