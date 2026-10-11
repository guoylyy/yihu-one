"""__NAME__ —— 以虎 One 平台应用（由 yh new 生成的模板，Python 标准库，零依赖）
已接好：统一登录、/health 健康检查、使用数据上报。开发文档：平台地址 /dev
"""
import html
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from yh_one import Workspace, WorkspaceError, base_path_of

ws = Workspace()


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
            who = f"{html.escape(user['name'])}" if user else "匿名用户（未接入平台）"
            return self._send(200, f'<meta charset="utf-8"><body style="font:15px system-ui;padding:24px"><h2>__NAME__</h2><p>你好，{who}</p></body>')
        return self._send(404, "not found", "text/plain")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    print(f"[__CODE__] listening on :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
