// 平台版本号：根目录 VERSION、控制台前后端 package.json / lock 必须一致（只用 scripts/bump-version.sh 改），版本更新说明里要有这个版本
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const root = new URL('../../../', import.meta.url)
const read = p => readFileSync(new URL(p, root), 'utf8')

test('版本号 x.y.z，各处一致', () => {
  const v = read('VERSION').trim()
  assert.match(v, /^\d+\.\d+\.\d+$/)
  for (const p of ['console/backend/package.json', 'console/frontend/package.json', 'console/backend/package-lock.json', 'console/frontend/package-lock.json']) {
    if (!existsSync(new URL(p, root))) continue
    const j = JSON.parse(read(p))
    assert.equal(j.version, v, `${p} 的版本 ${j.version} ≠ VERSION ${v}（用 scripts/bump-version.sh 改）`)
    if (j.packages?.['']) assert.equal(j.packages[''].version, v, `${p} packages[""] 的版本不一致`)
  }
})

test('版本更新说明里有当前版本', () => {
  const v = read('VERSION').trim()
  assert.match(read('console/docs/devcenter/releases.md'), new RegExp(`^## v${v.replace(/\./g, '\\.')}\\b`, 'm'), `console/docs/devcenter/releases.md 里没有「## v${v}」`)
})

test('install.sh 里写死的签名公钥和 platform/release.pub 一致', () => {
  const pubPath = new URL('platform/release.pub', root)
  if (!existsSync(pubPath)) return
  const m = read('install.sh').match(/^RELEASE_PUB="([^"]+)"/m)
  assert.ok(m, 'install.sh 里没有 RELEASE_PUB')
  assert.equal(m[1].trim(), read('platform/release.pub').trim(), '换了签名密钥：install.sh 的 RELEASE_PUB 要一起改')
})
