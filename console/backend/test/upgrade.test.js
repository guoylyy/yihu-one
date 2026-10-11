// 平台升级的纯逻辑：版本比较、识别更新包
import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const { newer, readPackageMeta } = await import('../src/services/upgrade.js')

/** 造一个 tar.gz：{ 路径: 内容 } */
function targz(files) {
  const blocks = []
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content)
    const h = Buffer.alloc(512)
    h.write(name, 0)
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
    h.write('00000000000\0', 136)
    h.write('        ', 148); h.write('0', 156); h.write('ustar\0' + '00', 257)
    h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(blocks))
}

test('版本比较：按数字比，不是按字符串', () => {
  assert.equal(newer('0.2.0', '0.1.9'), true)
  assert.equal(newer('0.10.0', '0.9.0'), true)
  assert.equal(newer('1.0.0', '1.0.0'), false)
  assert.equal(newer('0.9.0', '0.10.0'), false)
  assert.equal(newer('abc', '0.1.0'), false)
  assert.equal(newer('0.1.0', undefined), false)
})

test('更新包：读出版本、最低可升级版本和更新说明', () => {
  const pkg = targz({
    'yihu-one-0.2.0/VERSION': '0.2.0\n',
    'yihu-one-0.2.0/yh': '#!/bin/bash\n',
    'yihu-one-0.2.0/.yh-release': JSON.stringify({ version: '0.2.0', minVersion: '0.1.0', date: '2026-10-02', notes: '- 平台升级' }),
    'yihu-one-0.2.0/console/backend/src/index.js': 'x'.repeat(1300)
  })
  assert.deepEqual(readPackageMeta(pkg), { version: '0.2.0', minVersion: '0.1.0', date: '2026-10-02', notes: '- 平台升级' })
})

test('更新包：不是 gzip、没有版本号、别的 tar 包都拒绝', () => {
  const bad = (buf) => assert.throws(() => readPackageMeta(buf), (e) => e.status === 400 && /不是以虎 One 的更新包/.test(e.message))
  bad(Buffer.from('hello'))
  bad(targz({ 'some-app/README.md': 'hi' }))
  bad(targz({ 'yihu-one-x/VERSION': 'latest', 'yihu-one-x/yh': '#!/bin/bash' }))
  bad(targz({ 'yihu-one-0.2.0/VERSION': '0.2.0' }))
})
