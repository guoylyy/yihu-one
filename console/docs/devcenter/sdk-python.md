---
title: Python SDK
category: SDK 与示例
order: 40
summary: yh_one.py，标准库实现，一个文件搞定统一认证、使用数据、MCP 身份
updated: 2026-09-28
---

# Python SDK

下载 [`/sdk/yh_one.py`](/sdk/yh_one.py)，放进项目即可。**只用标准库**，Python 3.10+，适合 `http.server`、Flask、FastAPI 等任何框架。

## 配置

环境变量 `YH_CLIENT_ID`、`YH_CLIENT_SECRET`、`YH_WEB_URL`、`YH_API_URL`、`YH_APP_URL`，含义见 [快速开始](/dev/quickstart)；部署到平台时还有 `YH_BASE_PATH`（见 [部署规范](/dev/deploy) 第 4 节，平台自动注入）。**没配凭证时 SDK 不启用**，应用保持匿名模式，方便本地开发。

## API

```python
from yh_one import Workspace, WorkspaceError, base_path_of
ws = Workspace()                 # 读环境变量；ws.enabled 表示是否已接入

# 统一认证
user = ws.current_user(cookie_header)                  # 已登录的用户 dict，未登录 None
prefix = base_path_of(request_headers)                 # 平台转发的路径前缀，如 "/apps/purchase"；直连时 ""
url, set_cookie = ws.begin_login(cookie_header, "/", prefix)   # 未登录：302 到 url，带上 set_cookie（cookie 限定在 prefix 下）
next_path = ws.finish_login(cookie_header, code, state)  # /sso/callback 里调用，失败抛 WorkspaceError
ws.logout(cookie_header)

# 使用数据
ws.track(user, "quote.compare", {"to": "北京市朝阳区", "weight": 5})

# MCP 身份
user = ws.user_from_token(request_headers.get("Authorization"))   # 无效返回 None
```

## Flask 示例

```python
from flask import Flask, request, redirect, jsonify, make_response
from yh_one import Workspace, WorkspaceError, base_path_of

app, ws = Flask(__name__), Workspace()

@app.before_request
def require_login():
    if not ws.enabled or request.path in ("/sso/callback", "/mcp"):
        return
    if ws.current_user(request.headers.get("Cookie")):
        return
    if request.path.startswith("/api/"):
        return jsonify(error="未登录"), 401
    url, cookie = ws.begin_login(request.headers.get("Cookie"), request.full_path, base_path_of(request.headers))
    resp = redirect(url)
    if cookie:
        resp.headers["Set-Cookie"] = cookie
    return resp

@app.get("/sso/callback")
def callback():
    try:
        return redirect(ws.finish_login(request.headers.get("Cookie"), request.args.get("code"), request.args.get("state")))
    except WorkspaceError as e:
        return f"登录失败：{e}", 401

@app.get("/")
def home():
    user = ws.current_user(request.headers.get("Cookie"))
    ws.track(user, "home.view")
    return f"你好，{user['name']}"
```

`http.server` 的完整写法见 `yh new <code> --from python` 生成的 `app.py`。

## 注意

- 会话存在进程内存里，适合单进程部署；多进程（如 gunicorn 多 worker）请把 `_sessions` 换成 Redis
- 使用数据在后台线程每 3 秒批量发送，队列上限 1 万条，满了直接丢弃，不阻塞业务
