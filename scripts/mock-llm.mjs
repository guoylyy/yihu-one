// 自测用的假大模型（OpenAI 兼容 /v1/chat/completions，流式），selftest.sh 把它跑在一个临时容器里
// - 系统提示里有「轻应用生成器」：返回一个页面
// - 有工具且最后一条是用户消息：调第一个工具
// - 其他：回一句带诊断信息的话
// 每次请求往标准输出打一行 JSON（工具名、是否带发布者设定），自测用 docker logs 检查
import http from 'node:http'
const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
http.createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const j = JSON.parse(body || '{}')
    const sys = j.messages?.find(m => m.role === 'system')?.content || ''
    const last = j.messages?.[j.messages.length - 1]
    const tools = (j.tools || []).map(t => t.function.name)
    console.log(JSON.stringify({ tools, hasAgent: sys.includes('<<<'), lite: sys.includes('轻应用生成器') }))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (sys.includes('轻应用生成器')) {
      const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1 id="t">自测页面</h1><script>yh.ready.then(function (u) { document.getElementById("t").textContent = "你好 " + u.user.name; return yh.ai.ask("hi") })</script></body></html>'
      for (const part of ['做好了。\n\n```html\n', html, '\n```\n']) sse(res, { choices: [{ delta: { content: part } }] })
    } else if (tools.length && last?.role === 'user') {
      sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: tools[0], arguments: '{}' } }] } }] })
    } else {
      sse(res, { choices: [{ delta: { content: `MOCK 回答（工具 ${tools.length} 个）` } }] })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
}).listen(18999, () => console.log(JSON.stringify({ ready: true })))
