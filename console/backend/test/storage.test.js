// 文件存储（七牛云）：签名、key 收敛、上传凭证的范围；用一个假的七牛服务端走一遍 上传 / 查询 / 列举 / 删除
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const qn = await import('../src/lib/qiniu.js')
const { cleanKey, appRoot } = await import('../src/services/objectStorage.js')

const cfg = { accessKey: 'AK_TEST', secretKey: 'SK_TEST', bucket: 'demo-bucket' }
const sign = (data) => crypto.createHmac('sha1', 'SK_TEST').update(data).digest('base64').replace(/\+/g, '-').replace(/\//g, '_')

test('URL 安全的 Base64 和 EncodedEntryURI', () => {
  assert.equal(qn.urlsafe(Buffer.from([0xfb, 0xff, 0xfe])), '-__-')
  assert.equal(qn.entry('demo-bucket', 'a/b.txt'), Buffer.from('demo-bucket:a/b.txt').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'))
})

test('上传凭证 = AK:签名:编码后的策略，策略原样可解', () => {
  const policy = { scope: 'demo-bucket:apps/x/a.pptx', deadline: 1893456000 }
  const [ak, s, encoded] = qn.uploadToken(cfg, policy).split(':')
  assert.equal(ak, 'AK_TEST')
  assert.equal(s, sign(encoded))
  assert.deepEqual(JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()), policy)
})

test('私有空间下载地址：对带 e= 的完整地址签名', () => {
  const url = qn.privateUrl(cfg, 'https://files.example.com/apps/x/%E8%AF%BE%E4%BB%B6.pptx', 1893456000)
  const [base, token] = url.split('&token=')
  assert.equal(base, 'https://files.example.com/apps/x/%E8%AF%BE%E4%BB%B6.pptx?e=1893456000')
  assert.equal(token, `AK_TEST:${sign(base)}`)
  assert.ok(qn.privateUrl(cfg, 'https://f.example.com/a.pdf?attname=x.pdf', 1).includes('?attname=x.pdf&e=1&token='))
})

test('公开地址：文件名按段编码，/ 保留', () => {
  assert.equal(qn.publicUrl('https://f.example.com/', 'apps/x/课件 1.pptx'), 'https://f.example.com/apps/x/%E8%AF%BE%E4%BB%B6%201.pptx')
})

test('key 收敛：相对路径，不能越出应用自己的目录', () => {
  assert.equal(cleanKey('/courseware//B-05.pptx'), 'courseware/B-05.pptx')
  assert.equal(cleanKey('a\\b.txt'), 'a/b.txt')
  for (const bad of ['../other/x', 'a/../../b', './a', '', 'a\u0000b']) assert.throws(() => cleanKey(bad))
  assert.equal(cleanKey('', { allowEmpty: true }), '')
  assert.equal(appRoot({ keyPrefix: 'yihu-one/' }, { code: 'trade-training' }), 'yihu-one/apps/trade-training/')
})

test('管理凭证（QBox）对「路径?查询\\n」签名', () => {
  assert.equal(qn.qboxAuth(cfg, '/stat/abc'), `QBox AK_TEST:${sign('/stat/abc\n')}`)
})

test('假七牛：上传 → 查询 → 列举 → 删除，管理请求的签名都对', async () => {
  const files = new Map()
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = Buffer.concat(chunks)
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.url === '/up') {
      const text = body.toString('latin1')
      const field = (n) => text.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`))?.[1]
      const token = field('token'), key = field('key')
      const [, s, encoded] = token.split(':')
      if (s !== sign(encoded)) return send(401, { error: 'bad token' })
      const policy = JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
      if (policy.scope !== `demo-bucket:${key}`) return send(403, { error: 'scope mismatch' })
      files.set(key, 42)
      return send(200, { key, hash: 'Fh' })
    }
    if (req.headers.authorization !== `QBox AK_TEST:${sign(`${req.url}\n`)}`) return send(401, { error: 'bad auth' })
    const key = (p) => Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString().split(':').slice(1).join(':')
    if (req.url.startsWith('/stat/')) { const k = key(req.url.slice(6)); return files.has(k) ? send(200, { fsize: files.get(k), hash: 'Fh', mimeType: 'text/plain', putTime: 17000000000000000 }) : send(612, { error: 'no such file or directory' }) }
    if (req.url.startsWith('/delete/')) { files.delete(key(req.url.slice(8))); return send(200, {}) }
    if (req.url.startsWith('/list?')) { const q = new URLSearchParams(req.url.slice(6)); return send(200, { items: [...files.keys()].filter(k => k.startsWith(q.get('prefix'))).map(k => ({ key: k, fsize: files.get(k), mimeType: 'text/plain', hash: 'Fh', putTime: 17000000000000000 })) }) }
    send(404, { error: 'not found' })
  })
  await new Promise(r => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  qn.REGIONS.fake = { label: 'fake', up: `${base}/up`, rs: base, rsf: base }
  const c = { ...cfg, region: 'fake' }
  try {
    await qn.put(c, 'yihu-one/apps/x/a.txt', Buffer.from('hello'), { mime: 'text/plain' })
    assert.equal((await qn.stat(c, 'yihu-one/apps/x/a.txt')).fsize, 42)
    assert.deepEqual((await qn.list(c, { prefix: 'yihu-one/apps/x/' })).items.map(i => i.key), ['yihu-one/apps/x/a.txt'])
    await qn.remove(c, 'yihu-one/apps/x/a.txt')
    await assert.rejects(qn.stat(c, 'yihu-one/apps/x/a.txt'), e => e.status === 612)
  } finally {
    delete qn.REGIONS.fake
    server.close()
  }
})
