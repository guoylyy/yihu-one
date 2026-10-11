"""以虎 One 应用接入 SDK（Python 标准库版，零依赖）。

一个文件解决四件事，其他 Python 应用可以直接拷贝使用：

  1. 统一认证：没登录就跳平台授权页，回调时用 code 换用户身份，建本地会话
  2. 使用数据：把「谁在应用里做了什么」上报给平台（后台线程批量发送，失败不影响业务）
  3. 身份校验：平台 AI 助手调本应用 MCP 时带的 access_token，换成用户身份
  4. 大模型：应用直接用平台配置好的模型（OpenAI 兼容），不用自己配密钥

配置（环境变量）：
  YH_CLIENT_ID / YH_CLIENT_SECRET   平台托管的应用由 yh 自动注入；外部应用在「管理 → 应用 → 登记外部应用」获得
  YH_WEB_URL                        平台访问地址（浏览器跳转授权页用）
  YH_API_URL                        平台接口地址（服务端换 token、上报数据用；平台内是 http://yh-console:3105）
  YH_APP_URL                        本应用对外地址，回调地址 = YH_APP_URL + /sso/callback
  YH_BASE_PATH                      平台挂载的路径前缀（如 /apps/express，平台自动注入；本地开发不用配）

挂在平台域名的 /apps/<code> 下时，平台剥掉前缀再转发，前缀放在 X-Forwarded-Prefix 请求头里：
页面里的接口地址写相对路径（fetch("api/x")，不要写 "/api/x"），服务端跳转和 cookie 路径用 base_path_of() 拼。

文档：平台开发中心 /dev/sdk-python    下载：/sdk/yh_one.py
"""
from __future__ import annotations

import base64
import http.client
import json
import os
import queue
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from http.cookies import SimpleCookie
from urllib.parse import urlencode, urlparse

SESSION_COOKIE = "yh_sid"
SESSION_TTL = 8 * 3600          # 本地会话 8 小时，过期后再走一次统一认证（用户无感）
STATE_TTL = 600                 # 授权跳转 10 分钟内要回来
TOKEN_CACHE_TTL = 300           # MCP 调用的 token → 用户 缓存 5 分钟
_PREFIX_RE = re.compile(r"^/apps/[a-z0-9-]+$")


def base_path_of(headers) -> str:
    """平台转发时带的路径前缀（X-Forwarded-Prefix），如 /apps/express；直连（本地开发）时为空串。"""
    p = ((headers.get("X-Forwarded-Prefix") if headers else None) or "").strip().rstrip("/")
    return p if _PREFIX_RE.match(p) else ""


class WorkspaceError(Exception):
    pass


@dataclass
class Session:
    user: dict | None = None
    state: str | None = None
    state_at: float = 0
    next_path: str = "/"
    expires_at: float = field(default_factory=lambda: time.time() + SESSION_TTL)


class Workspace:
    def __init__(self, client_id=None, client_secret=None, web_url=None, api_url=None, app_url=None):
        self.client_id = client_id or os.environ.get("YH_CLIENT_ID", "")
        self.client_secret = client_secret or os.environ.get("YH_CLIENT_SECRET", "")
        self.web_url = (web_url or os.environ.get("YH_WEB_URL", "http://localhost:5185")).rstrip("/")
        self.api_url = (api_url or os.environ.get("YH_API_URL", "http://localhost:3105")).rstrip("/")
        self.app_url = (app_url or os.environ.get("YH_APP_URL", "")).rstrip("/")
        bp = os.environ.get("YH_BASE_PATH", "").rstrip("/")
        self.base_path = bp if _PREFIX_RE.match(bp) else ""
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()
        self._token_cache: dict[str, tuple[float, dict]] = {}
        self._events: queue.Queue = queue.Queue(maxsize=10000)
        if self.enabled:
            threading.Thread(target=self._flush_loop, daemon=True, name="yh-usage").start()

    @property
    def enabled(self) -> bool:
        """没配凭证时不启用：应用保持原来的匿名模式，方便本地开发。"""
        return bool(self.client_id and self.client_secret and self.app_url)

    @property
    def redirect_uri(self) -> str:
        return f"{self.app_url}/sso/callback"

    # ------------------------------------------------------------ HTTP
    def _basic(self) -> str:
        return "Basic " + base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()

    def _call(self, method: str, path: str, body=None, headers=None, timeout=10) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.api_url + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                payload = json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b"{}")
            except json.JSONDecodeError:
                payload = {"message": f"HTTP {e.code}"}
        except (urllib.error.URLError, TimeoutError) as e:
            raise WorkspaceError(f"连不上平台 {self.api_url}：{e}") from e
        if payload.get("code") != 0:
            raise WorkspaceError(payload.get("message") or "平台返回错误")
        return payload["data"]

    # ------------------------------------------------------------ 会话
    def session_id(self, cookie_header: str | None) -> str | None:
        if not cookie_header:
            return None
        c = SimpleCookie()
        try:
            c.load(cookie_header)
        except Exception:
            return None
        m = c.get(SESSION_COOKIE)
        return m.value if m else None

    def _get(self, sid: str | None) -> Session | None:
        if not sid:
            return None
        with self._lock:
            s = self._sessions.get(sid)
            if s and s.expires_at < time.time():
                self._sessions.pop(sid, None)
                return None
            return s

    def current_user(self, cookie_header: str | None) -> dict | None:
        """当前登录的用户；未登录返回 None。未启用统一认证时恒为 None。"""
        s = self._get(self.session_id(cookie_header))
        return s.user if s else None

    def begin_login(self, cookie_header: str | None, next_path: str = "/", base_path: str = "") -> tuple[str, str | None]:
        """返回 (授权页地址, 需要设置的 Set-Cookie 或 None)。base_path 传 base_path_of(请求头)。"""
        sid = self.session_id(cookie_header)
        s = self._get(sid)
        set_cookie = None
        if not s:
            sid = secrets.token_urlsafe(24)
            s = Session()
            with self._lock:
                self._sessions[sid] = s
            # 同一域名下挂着多个应用，cookie 限定在本应用的路径下，互不覆盖
            set_cookie = f"{SESSION_COOKIE}={sid}; Path={base_path or '/'}; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL}"
        s.state = secrets.token_urlsafe(16)
        s.state_at = time.time()
        s.next_path = base_path + (next_path if next_path.startswith("/") and not next_path.startswith("//") else "/")
        url = f"{self.web_url}/sso/authorize?" + urlencode(
            {"client_id": self.client_id, "redirect_uri": self.redirect_uri, "state": s.state})
        return url, set_cookie

    def finish_login(self, cookie_header: str | None, code: str, state: str) -> str:
        """回调：校验 state → code 换用户身份 → 写进会话。返回登录后要去的路径。"""
        s = self._get(self.session_id(cookie_header))
        if not s or not s.state or not state or not secrets.compare_digest(s.state, state):
            raise WorkspaceError("登录校验失败（state 不匹配），请从平台重新打开应用")
        if time.time() - s.state_at > STATE_TTL:
            raise WorkspaceError("登录超时，请从平台重新打开应用")
        data = self._call("POST", "/api/sso/token", {"code": code, "redirect_uri": self.redirect_uri},
                          headers={"Authorization": self._basic()})
        s.user = data["user"]
        s.state = None
        s.expires_at = time.time() + SESSION_TTL
        return s.next_path

    def logout(self, cookie_header: str | None) -> None:
        sid = self.session_id(cookie_header)
        if sid:
            with self._lock:
                self._sessions.pop(sid, None)

    # ------------------------------------------------------------ MCP 身份
    def user_from_token(self, authorization: str | None) -> dict | None:
        """平台 AI 助手调 MCP 时带 Bearer access_token（代表当前用户），换成用户信息。"""
        if not authorization or not authorization.startswith("Bearer "):
            return None
        token = authorization[7:].strip()
        hit = self._token_cache.get(token)
        if hit and hit[0] > time.time():
            return hit[1]
        try:
            user = self._call("GET", "/api/sso/userinfo", headers={"Authorization": f"Bearer {token}"})
        except WorkspaceError:
            return None
        self._token_cache[token] = (time.time() + TOKEN_CACHE_TTL, user)
        return user

    # ------------------------------------------------------------ 使用数据
    def track(self, user: dict | None, action: str, detail: dict | None = None) -> None:
        """记录一次使用。只报动作和业务摘要，不要报敏感原文（聊天内容、手机号等）。"""
        if not self.enabled or not user:
            return
        ev = {"userId": user["id"], "action": action,
              "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        if detail:
            ev["detail"] = detail
        try:
            self._events.put_nowait(ev)
        except queue.Full:
            pass  # 宁可丢统计，也不能拖慢业务

    def _flush_loop(self):
        while True:
            batch = [self._events.get()]
            deadline = time.time() + 3
            while len(batch) < 100 and time.time() < deadline:
                try:
                    batch.append(self._events.get(timeout=max(0.1, deadline - time.time())))
                except queue.Empty:
                    break
            for attempt in range(2):
                try:
                    r = self._call("POST", "/api/open/events", {"events": batch},
                                   headers={"Authorization": self._basic()})
                    if r.get("rejected"):
                        print(f"[yh-one] 上报被拒 {len(r['rejected'])} 条：{r['rejected'][:3]}", file=sys.stderr)
                    break
                except WorkspaceError as e:
                    if attempt:
                        print(f"[yh-one] 使用数据上报失败，丢弃 {len(batch)} 条：{e}", file=sys.stderr)
                    else:
                        time.sleep(2)

    # ------------------------------------------------------------ 大模型
    def llm(self, opts: dict, timeout: int = 120):
        """调用平台托管的大模型（OpenAI 兼容）。

        opts 同 OpenAI chat.completions：messages（必填）、model、temperature、tools、stream 等，
        默认用平台默认模型；opts["userToken"] 可选（统一认证的 access_token），
        传入后按人记用量、按角色过滤模型。
        非流式返回 chat.completion dict；stream=True 返回可迭代对象，逐条产出 SSE 中的 dict。
        """
        if not (self.client_id and self.client_secret):
            raise WorkspaceError("缺少应用凭证（YH_CLIENT_ID/YH_CLIENT_SECRET）")
        if not opts.get("messages"):
            raise WorkspaceError("messages 不能为空")
        u = urlparse(self.api_url + "/api/open/llm/chat/completions")
        conn_cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(u.hostname, u.port, timeout=timeout)
        headers = {"Content-Type": "application/json", "Authorization": self._basic()}
        if opts.get("userToken"):
            headers["X-User-Token"] = opts["userToken"]
        conn.request("POST", u.path, body=json.dumps(opts).encode(), headers=headers)
        resp = conn.getresponse()
        if resp.status >= 400:
            try:
                payload = json.loads(resp.read() or b"{}")
            except json.JSONDecodeError:
                payload = {}
            conn.close()
            raise WorkspaceError((payload.get("error") or {}).get("message")
                                 or f"平台返回 HTTP {resp.status}")
        if opts.get("stream"):
            return self._iter_sse(conn, resp)
        data = json.loads(resp.read() or b"{}")
        conn.close()
        return data

    def _iter_sse(self, conn, resp):
        """迭代 OpenAI SSE：data: 行解析为 dict 产出，[DONE] 结束。"""
        try:
            for raw in resp:
                line = raw.decode().strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    yield json.loads(data)
                except json.JSONDecodeError:
                    pass
        finally:
            conn.close()
