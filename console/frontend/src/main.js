import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { onUnauthorized } from './api'
import { useUserStore } from './stores/user'
import '@fontsource-variable/manrope'
import './styles/main.css'
import { restoreTheme } from './utils/theme'
import { applyCachedTitle } from './utils/brandCache'

restoreTheme()
applyCachedTitle()

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// 401：清登录态，跳登录并带上当前页面
onUnauthorized(() => {
  const user = useUserStore(pinia)
  user.logout()
  const cur = router.currentRoute.value
  if (cur.meta?.public) return
  router.replace({ name: 'Login', query: { redirect: cur.fullPath } })
})

app.mount('#app')
