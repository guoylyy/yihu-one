"""__NAME__ —— 以虎 One 平台应用（由 yh new 生成的模板，Python 标准库，零依赖）
已接好：统一登录、/health 健康检查、使用数据上报。开发文档：平台地址 /dev
平台入口一半在手机，改动前先看 console/docs/devcenter/checklist.md『移动端与自适应』（首页就是响应式基线：viewport、断点、卡片列表、44px 触控、安全区）
"""
import html
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from yh_one import Workspace, WorkspaceError, base_path_of

ws = Workspace()

# 首页：和 Node 模板同一份页面；{who} 处填当前用户（CSS 里有花括号，所以不用 f-string / format）
PAGE = """<!doctype html>
<!-- 平台入口一半在手机，改动前先看 console/docs/devcenter/checklist.md『移动端与自适应』 -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>__NAME__</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; background: #f5f6f7; }
  /* 正文不小于 14px；内容区限最大宽度、不写死宽度，底部留出操作条的高度 */
  main { max-width: 960px; margin: 0 auto; padding: 16px 16px 96px; }
  h1 { font-size: 20px; margin: 8px 0 4px; }
  .muted { color: #646a73; margin: 0 0 16px; }
  /* 列表：宽屏是多列表格；≤768px 变成「标签 + 值」卡片堆叠，标签取每格的 data-label（纯 CSS，不用 JS） */
  .list { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
  .list th, .list td { padding: 8px 16px; text-align: left; border-bottom: 1px solid #ebedf0; overflow-wrap: anywhere; }
  .list th { font-weight: 500; color: #646a73; background: #fafbfc; }
  @media (max-width: 768px) {
    .list, .list tbody, .list tr, .list td { display: block; width: 100%; }
    .list { background: none; }
    .list thead { display: none; }
    .list tr { background: #fff; border-radius: 8px; padding: 4px 0; margin-bottom: 12px; }
    .list td { display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 0; padding: 4px 16px; text-align: right; }
    .list td::before { content: attr(data-label); color: #646a73; text-align: left; flex-shrink: 0; }
  }
  /* 可点元素至少 44×44px：这是手指触控的最小舒适尺寸（Apple HIG），再小在手机上就容易点错、点不中 */
  .btn, .link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; }
  .link { padding: 0 8px; color: #3370ff; text-decoration: none; }
  .btn { padding: 0 20px; border: 1px solid #3370ff; border-radius: 8px; font: inherit; color: #3370ff; background: #fff; cursor: pointer; }
  .btn.primary { color: #fff; background: #3370ff; }
  /* 底部固定操作条：iPhone 底部有手势条，加上安全区的内边距按钮才不会被挡住（要配合 viewport-fit=cover） */
  .bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: flex-end; gap: 12px; padding: 8px 16px; padding-bottom: calc(8px + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid #ebedf0; }
  @media (max-width: 768px) { .bar .btn { flex: 1; } }
</style>
</head>
<body>
<main>
  <h1>__NAME__</h1>
  <p class="muted">你好，{who}。从这里开始写你的应用（下面是示例数据）。</p>
  <table class="list">
    <thead><tr><th>单号</th><th>事项</th><th>申请人</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>
      <tr><td data-label="单号">A-1001</td><td data-label="事项">办公用品采购</td><td data-label="申请人">张三</td><td data-label="金额">¥1,280.00</td><td data-label="状态">待审批</td><td data-label="操作"><a class="link" href="#">查看</a></td></tr>
      <tr><td data-label="单号">A-1002</td><td data-label="事项">客户拜访差旅</td><td data-label="申请人">李四</td><td data-label="金额">¥3,460.00</td><td data-label="状态">已通过</td><td data-label="操作"><a class="link" href="#">查看</a></td></tr>
      <tr><td data-label="单号">A-1003</td><td data-label="事项">展会物料制作</td><td data-label="申请人">王五</td><td data-label="金额">¥8,900.00</td><td data-label="状态">已驳回</td><td data-label="操作"><a class="link" href="#">查看</a></td></tr>
    </tbody>
  </table>
</main>
<div class="bar"><button class="btn" type="button">导出</button><button class="btn primary" type="button">新建</button></div>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/html; charset=utf-8", headers=None):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        cookie = self.headers.get("Cookie")
        if u.path == "/health":
            return self._send(200, json.dumps({"ok": True}), "application/json")
        if u.path == "/sso/callback":
            qs = parse_qs(u.query)
            try:
                nxt = ws.finish_login(cookie, (qs.get("code") or [""])[0], (qs.get("state") or [""])[0])
            except WorkspaceError as e:
                return self._send(401, f"登录失败：{html.escape(str(e))}")
            return self._send(302, "", headers={"Location": nxt})
        user = ws.current_user(cookie)
        if ws.enabled and not user:
            url, set_cookie = ws.begin_login(cookie, u.path, base_path_of(self.headers))
            return self._send(302, "", headers={"Location": url, **({"Set-Cookie": set_cookie} if set_cookie else {})})
        if u.path == "/":
            ws.track(user, "home.view")
            who = html.escape(user["name"]) if user else "匿名用户（未接入平台）"
            return self._send(200, PAGE.replace("{who}", who))
        return self._send(404, "not found", "text/plain")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    print(f"[__CODE__] listening on :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
