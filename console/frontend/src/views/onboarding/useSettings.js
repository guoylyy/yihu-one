// 开通向导里读写系统设置：和「管理 → 系统设置 / 登录方式」是同一份配置（settingsApi）
import { reactive, ref } from 'vue'
import { settingsApi } from '@/api/admin'

/** 某个管理页（settings / login）的设置组；draft[group][field] 是草稿，save(group, keys) 只提交这些项 */
export function useSettings(page) {
  const groups = ref({})
  const draft = reactive({})
  const loading = ref(false)

  const initial = f => (f.type === 'theme'
    ? { preset: f.resolved.preset, tokens: Object.fromEntries((f.resolved.custom || []).map(k => [k, f.resolved.tokens[k]])) }
    : f.type === 'password' ? '' : f.type === 'list' ? [...(f.value || [])] : f.value ?? (f.type === 'bool' ? false : ''))

  async function load() {
    loading.value = true
    try {
      const list = await settingsApi.list(page)
      groups.value = Object.fromEntries(list.map(g => [g.key, { ...g, byKey: Object.fromEntries(g.fields.map(f => [f.key, f])) }]))
      for (const g of list) draft[g.key] = Object.fromEntries(g.fields.map(f => [f.key, initial(f)]))
    } finally {
      loading.value = false
    }
  }

  /** 提交一组里的几项；密码空着 = 不改 */
  async function save(group, keys) {
    const body = {}
    for (const k of keys) {
      const f = groups.value[group]?.byKey[k]
      if (!f) continue
      if (f.type === 'password' && !draft[group][k]) continue
      body[k] = draft[group][k]
    }
    if (Object.keys(body).length) await settingsApi.save(group, body)
  }

  const field = (group, key) => groups.value[group]?.byKey[key] || null
  return { groups, draft, loading, load, save, field }
}
