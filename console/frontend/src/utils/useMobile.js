import { ref, onMounted, onBeforeUnmount } from 'vue'

const BREAKPOINT = 768
const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < BREAKPOINT : false)
let listeners = 0
function onResize() { isMobile.value = window.innerWidth < BREAKPOINT }

/** 响应式判断窄屏（钉钉手机端） */
export function useMobile() {
  onMounted(() => {
    if (listeners++ === 0) window.addEventListener('resize', onResize)
    onResize()
  })
  onBeforeUnmount(() => {
    if (--listeners === 0) window.removeEventListener('resize', onResize)
  })
  return isMobile
}
