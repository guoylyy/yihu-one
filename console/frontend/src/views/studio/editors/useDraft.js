// 编辑器共用：草稿自动保存（停止输入 800ms 后存一次）
import { ref, watch, inject, nextTick } from 'vue'
import { studioApi } from '@/api/market'

// init(payload, permissions)：在开始监听前补默认值，只打开不修改就不会生成草稿
export function useDraft(app, emit, { pick, init } = {}) {
  const payload = ref(JSON.parse(JSON.stringify(app.working?.payload || {})))
  const permissions = ref(JSON.parse(JSON.stringify(app.working?.permissions || {})))
  if (init) init(payload.value, permissions.value)
  const reload = inject('reloadApp', null)
  // 当前草稿版本 id（试聊、预览要用）；打开时内容来自已发布版本则为空，第一次保存后才有
  const draftId = ref(app.working?.status === 'DRAFT' ? app.working.id : null)
  let timer = null
  let dirty = false

  /** 保存草稿；force=true 时即使没改也存一次（确保有草稿版本）。返回草稿 id */
  async function save(force = false) {
    clearTimeout(timer)
    if (!dirty && !(force && !draftId.value)) return draftId.value
    dirty = false
    emit('saving', '保存中…')
    try {
      const body = { payload: pick ? pick(payload.value) : payload.value }
      if (permissions.value && Object.keys(permissions.value).length) body.permissions = permissions.value
      const v = await studioApi.saveDraft(app.id, body)
      draftId.value = v.id
      emit('saving', '草稿已保存')
    } catch (e) {
      dirty = true
      emit('saving', `保存失败：${e.message}`)
      throw e
    }
    return draftId.value
  }
  // 用服务端的最新草稿覆盖本地（如轻应用生成完），不算修改、不触发保存
  let muted = false
  function replace(p, perm) {
    clearTimeout(timer)
    muted = true
    dirty = false
    payload.value = p
    if (perm !== undefined) permissions.value = perm
    nextTick(() => { muted = false })
  }

  watch([payload, permissions], () => {
    if (muted) return
    dirty = true
    emit('saving', '有未保存的修改')
    clearTimeout(timer)
    timer = setTimeout(save, 800)
  }, { deep: true })

  return { payload, permissions, save, reload, draftId, replace }
}
