// 浏览器标签页标题：品牌在前，首页只显示品牌名（node --test，不需要浏览器）
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { brandName, titleFor, applyTitle, bindTitle, DEFAULT_BRAND } from '../src/utils/title.js'

globalThis.document = { title: DEFAULT_BRAND }

// 和 src/stores/app.js 同形状：workspaceName 同样走 brandName，setBrand / setPageTitle 同样只改 state
const useApp = defineStore('app-title-test', {
  state: () => ({ config: null, cachedBrand: null, brand: null, titleOverride: null }),
  getters: { workspaceName: s => brandName(s) },
  actions: {
    setBrand(b) { this.brand = b || null },
    setPageTitle(path, title) { this.titleOverride = title ? { path, title } : null }
  }
})

const HOME = { name: 'Home', fullPath: '/', meta: { title: '工作台', nav: 'home' } }
const MARKET = { name: 'Market', fullPath: '/market', meta: { title: '应用市场', nav: 'market' } }
const LITE = { name: 'Lite', fullPath: '/lite/7', meta: { title: '轻应用', nav: 'market' } }
const DEV = { name: 'DevDoc', fullPath: '/dev/sso', meta: { public: true, devDoc: true } }

beforeEach(() => {
  setActivePinia(createPinia())
  document.title = DEFAULT_BRAND
})

test('1. 首页：document.title === 品牌名，不出现「工作台」', () => {
  const app = useApp()
  app.config = { workspaceName: '华丰电梯' }
  applyTitle(HOME, app)
  assert.equal(document.title, '华丰电梯')
  assert.doesNotMatch(document.title, /工作台/)
})

test('2. 其它页面：「页面名 · 品牌名」；轻应用用应用名，离开该地址后失效', () => {
  const app = useApp()
  app.config = { workspaceName: '华丰电梯' }
  applyTitle(MARKET, app)
  assert.equal(document.title, '应用市场 · 华丰电梯')
  app.setPageTitle('/lite/7', '周 OKR')
  applyTitle(LITE, app)
  assert.equal(document.title, '周 OKR · 华丰电梯')
  applyTitle({ ...LITE, fullPath: '/lite/8' }, app)
  assert.equal(document.title, '轻应用 · 华丰电梯')
})

test('3. 品牌优先级：空间 VI brand.name > config.workspaceName > 缓存 > 以虎 One', () => {
  assert.equal(brandName({ brand: { name: '华丰电梯' }, config: { workspaceName: '平台名' }, cachedBrand: { name: '缓存名' } }), '华丰电梯')
  assert.equal(brandName({ brand: { theme: {} }, config: { workspaceName: '平台名' }, cachedBrand: { name: '缓存名' } }), '平台名')
  assert.equal(brandName({ brand: null, config: null, cachedBrand: { name: '缓存名' } }), '缓存名')
  assert.equal(brandName({ brand: null, config: { workspaceName: '' }, cachedBrand: null }), '以虎 One')
  assert.equal(brandName(null), '以虎 One')
  assert.equal(titleFor(HOME, ''), '以虎 One')
  assert.equal(titleFor(MARKET, ''), '应用市场 · 以虎 One')
})

test('4. setBrand 换空间 / 配置加载后，经 bindTitle 的订阅立即重设标题', async () => {
  const app = useApp()
  let route = HOME
  bindTitle(app, () => route)
  app.config = { workspaceName: '平台名' }
  await nextTick()
  assert.equal(document.title, '平台名')
  app.setBrand({ name: '华丰电梯' })
  await nextTick()
  assert.equal(document.title, '华丰电梯')
  route = MARKET
  app.setBrand({ name: '另一空间' })
  await nextTick()
  assert.equal(document.title, '应用市场 · 另一空间')
  app.setBrand(null)
  await nextTick()
  assert.equal(document.title, '应用市场 · 平台名')
})

test('5. 开发中心页面：不覆盖它自己设置的标题（回归）', async () => {
  const app = useApp()
  app.config = { workspaceName: '华丰电梯' }
  document.title = '统一认证 · 开发中心'
  assert.equal(applyTitle(DEV, app), null)
  bindTitle(app, () => DEV)
  app.setBrand({ name: '另一空间' })
  await nextTick()
  assert.equal(document.title, '统一认证 · 开发中心')
})
