import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchVerifyFile } from '../src/services/settings.js'

test('企业微信可信域名验证文件：文件名对得上才返回内容', () => {
  const w = { verifyFileName: 'WW_verify_abc123.txt', verifyFileContent: '  Xy9kQ2  ' }
  assert.equal(matchVerifyFile('WW_verify_abc123.txt', w), 'Xy9kQ2')
  assert.equal(matchVerifyFile('WW_verify_other.txt', w), null, '别的文件名不返回')
  assert.equal(matchVerifyFile('WW_verify_abc123.txt', { ...w, verifyFileContent: '' }), null, '没填内容不返回')
  assert.equal(matchVerifyFile('../yh.env', w), null)
  assert.equal(matchVerifyFile('WW_verify_abc123.txt.bak', { ...w, verifyFileName: 'WW_verify_abc123.txt.bak' }), null, '只认 WW_verify_*.txt')
  assert.equal(matchVerifyFile('WW_verify_abc123.txt', { ...w, verifyFileContent: 'x'.repeat(201) }), null, '内容太长不返回')
  assert.equal(matchVerifyFile('WW_verify_abc123.txt', {}), null)
})
