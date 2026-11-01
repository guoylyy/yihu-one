// 生成自 yihu-brand/svg，勿手改（console/scripts/gen-brand-icons.mjs）
import { defineComponent, h } from 'vue'

/** code → 图标内容。主结构跟 currentColor，强调色 #d2521e 写死在 path 上，不随平台主色变 */
export const BRAND = {
  inbox: '<path d="M9.5 17h5l1.5-3H18a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h2Z"/><path d="M6.37 13.08L7 5.95A2 2 0 0 1 9.16 4.13L15.64 4.7A2 2 0 0 1 17.46 6.87L16.83 13.99"/><path d="M15 7.75v4l-3.46-2Z" fill="#d2521e" stroke="none"/>',
  meeting: '<path d="M6 5.25H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.25a2 2 0 0 1 2-2Z"/><path d="M8 3.875V7M16 3.875V7M4 8h16M8 11h8M8 14h6"/><path d="M8 17h2.5" stroke="#d2521e"/>',
  expiry: '<path d="M12 3.88L18.57 5.83A2 2 0 0 1 20 7.74L20 11.64A2 2 0 0 1 19.38 13.09L12 20.13L4.62 13.09A2 2 0 0 1 4 11.64L4 7.74A2 2 0 0 1 5.43 5.83L12 3.88Z"/><path d="M12 7v4.25l3.9 2.25"/><path d="M10.5 15.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z" fill="#d2521e" stroke="none"/>',
  knowledge: '<path d="M12 7C10.5 5 8.5 4 6 4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2c2.5 0 4.5.3 6 1.125V7Z"/><path d="M12 7c1.5-2 3.5-3 6-3a2 2 0 0 1 2 2v8.25L15.25 19C14 19.2 13 19.6 12 20.125"/><path d="M18 7.75v4l-3.46-2Z" fill="#d2521e" stroke="none"/>',
  hr: '<path d="M8.75 7.125a3.25 3.25 0 1 0 6.5 0a3.25 3.25 0 1 0 -6.5 0Z"/><path d="M4.5 20.125a7.5 6.375 0 0 1 15 0M4 20.125h16"/><path d="M10.75 7.125a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0 -2.5 0Z" fill="#d2521e" stroke="none"/>',
  crm: '<path d="M6 4H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M8.75 10a3.25 3.25 0 1 0 6.5 0a3.25 3.25 0 1 0 -6.5 0Z"/><path d="M8.5 17.25h7"/><path d="M10.75 10a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0 -2.5 0Z" fill="#d2521e" stroke="none"/>',
  fde: '<path d="M7.5 20.125L10.25 3.875M4 20.125h16"/><path d="M10.25 3.875L20 9.75 8.1 15.5"/><path d="M12 7.75v4l3.46-2Z" fill="#d2521e" stroke="none"/>',
  goods: '<path d="M12 3.88L18.92 7.44A2 2 0 0 1 20 9.22L20 14.78A2 2 0 0 1 18.92 16.56L12 20.13L5.08 16.56A2 2 0 0 1 4 14.78L4 9.22A2 2 0 0 1 5.08 7.44L12 3.88Z"/><path d="M4.29 8.18L12 12.05 19.71 8.18M12 12.05V20.125"/><path d="M10.5 8a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z" fill="#d2521e" stroke="none"/>',
  training: '<path d="M6 4H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M8.25 4v16"/><path d="M12 9v6l5.2-3Z" fill="#d2521e" stroke="none"/>',
  finance: '<path d="M7 4H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M3.875 7.25H7.25M3.875 11.75H7.25M3.875 16.25H7.25M15.75 16.75V6.75"/><path d="M9.75 16.75V14.25" stroke="#d2521e"/>',
  account: '<path d="M4 9.25c0-1.5 1-2.25 2.25-2.6l9.75-2.5a2 2 0 0 1 2.5 1.9V8"/><path d="M6 8H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z"/><path d="M4 12.75h10"/><path d="M15 12.75a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z" fill="#d2521e" stroke="none"/>',
  predict: '<path d="M4 20.125h16M4 17l4.5-7 3.5 4.75 3.25-6.5 1.75-1.75"/><path d="M16.75 5.25a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z" fill="#d2521e" stroke="none"/>'
}

const brandIcon = (code) => defineComponent({
  name: `Brand-${code}`,
  render: () => h('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    innerHTML: BRAND[code]
  })
})

/** `brand-<code>` → 组件，并入 utils/icons.js 的 ICONS */
export const BRAND_ICONS = Object.fromEntries(Object.keys(BRAND).map(code => [`brand-${code}`, brandIcon(code)]))
