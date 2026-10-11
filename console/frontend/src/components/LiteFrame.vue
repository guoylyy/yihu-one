<template>
  <!--
    轻应用沙箱：页面是员工 / AI 写的，按不可信代码对待
    - sandbox 不给 allow-same-origin：页面在一个「不透明来源」里运行，读不到控制台的登录令牌（localStorage）、cookie，也调不了控制台接口
    - 不给 allow-popups / allow-top-navigation：不能开新窗口、不能把控制台页面跳走
    - 注入的 CSP 禁止一切网络访问（fetch、图片外链、字体、WebSocket、表单提交都会被浏览器拦下），只能经由 window.yh 调平台
    - window.yh 通过 postMessage 和这里通信；这里只认这个 iframe 发来的消息，并且只提供白名单里的方法
  -->
  <iframe
    ref="frame"
    class="lite-frame"
    :srcdoc="srcdoc"
    sandbox="allow-scripts allow-forms allow-modals"
    referrerpolicy="no-referrer"
    :title="app?.name || '轻应用'"
  />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { liteApi } from '@/api/market'

const props = defineProps({
  appId: { type: [Number, String], required: true },
  html: { type: String, default: '' },
  // 预览草稿的版本 id（发布者 / 管理员）
  versionId: { type: [Number, String], default: null },
  app: { type: Object, default: null },
  user: { type: Object, default: null }
})
const emit = defineEmits(['call'])
const frame = ref(null)

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'"
].join('; ')

// 页面里的 window.yh（在 iframe 里执行）
const SDK = `(function () {
  var seq = 0, pending = {};
  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ __yh: 1, id: id, method: method, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) }, '*');
    });
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || !d.__yh || !pending[d.id]) return;
    var p = pending[d.id];
    delete pending[d.id];
    if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
  });
  var yh = {
    user: null, app: null,
    db: {
      list: function (c, q) { return call('db.list', { c: c, q: q || {} }); },
      get: function (c, id) { return call('db.get', { c: c, id: id }); },
      add: function (c, data, opt) { return call('db.add', { c: c, data: data, shared: !!(opt && opt.shared) }); },
      update: function (c, id, data) { return call('db.update', { c: c, id: id, data: data }); },
      remove: function (c, id) { return call('db.remove', { c: c, id: id }); }
    },
    ai: { ask: function (prompt, opt) { return call('ai.ask', { prompt: String(prompt), system: opt && opt.system }).then(function (r) { return r.text; }); } },
    tools: { call: function (name, args) { return call('tools.call', { name: name, args: args || {} }); } },
    toast: function (message, type) { call('toast', { message: String(message), type: type }); }
  };
  yh.ready = call('init').then(function (r) { yh.user = r.user; yh.app = r.app; return r; });
  window.yh = yh;
})();`

/** 去掉沙箱管不住的自动跳转（meta refresh），再把 CSP 和 SDK 放到 <head> 最前面 */
function build(html) {
  const clean = String(html || '').replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><script>${SDK}<\/script>`
  if (/<head[^>]*>/i.test(clean)) return clean.replace(/<head[^>]*>/i, m => m + head)
  if (/<html[^>]*>/i.test(clean)) return clean.replace(/<html[^>]*>/i, m => `${m}<head>${head}</head>`)
  return `<!DOCTYPE html><html><head>${head}</head><body>${clean}</body></html>`
}
const srcdoc = computed(() => build(props.html))

// ---------- 桥：只处理这个 iframe 发来的、白名单里的方法 ----------
const v = () => props.versionId || undefined
const HANDLERS = {
  init: () => ({ user: props.user, app: props.app ? { id: props.app.id, name: props.app.name } : null }),
  'db.list': a => liteApi.list(props.appId, a.c, a.q, v()),
  'db.get': a => liteApi.get(props.appId, a.c, a.id, v()),
  'db.add': a => liteApi.add(props.appId, a.c, { data: a.data, shared: a.shared }, v()),
  'db.update': a => liteApi.update(props.appId, a.c, a.id, { data: a.data }, v()),
  'db.remove': a => liteApi.remove(props.appId, a.c, a.id, v()),
  'ai.ask': a => liteApi.ask(props.appId, { prompt: a.prompt, system: a.system }, v()),
  'tools.call': a => liteApi.tool(props.appId, a.name, a.args, v()),
  toast: a => {
    const msg = String(a?.message || '').slice(0, 200)
    if (msg) ElMessage({ message: msg, type: a?.type === 'error' ? 'error' : 'success', grouping: true })
    return null
  }
}

async function onMessage(e) {
  const win = frame.value?.contentWindow
  if (!win || e.source !== win) return
  const d = e.data
  if (!d || d.__yh !== 1 || typeof d.id !== 'number' || typeof d.method !== 'string') return
  const reply = payload => win.postMessage({ __yh: 1, id: d.id, ...payload }, '*')
  const fn = HANDLERS[d.method]
  if (!fn) return reply({ error: `不支持的方法 ${d.method}` })
  emit('call', d.method)
  try {
    // 过一遍 JSON：去掉响应式代理，也保证传进沙箱的只有纯数据
    const result = await fn(d.args || {})
    reply({ result: result === undefined ? null : JSON.parse(JSON.stringify(result)) })
  } catch (err) {
    reply({ error: err.message || '调用失败' })
  }
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<style scoped>
.lite-frame { width: 100%; height: 100%; border: none; display: block; background: #fff; }
</style>
