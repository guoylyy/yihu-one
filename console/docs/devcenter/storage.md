---
title: 文件存储
category: 应用能力
order: 25
summary: 课件、视频、图片这类大文件放平台配置的对象存储（七牛云），不进代码仓库，应用不用自己配密钥
updated: 2026-10-15
---

# 文件存储

应用里的大文件——课件、视频、产品图、导出的报表——不要放进代码仓库，也不要塞进数据库。平台统一接了一个对象存储（目前是**七牛云 Kodo**），管理员配一次，所有应用用自己的凭证就能存取，密钥不出平台。

- **每个应用一个目录**：接口里的 `key` 都是相对本应用目录的路径（如 `courseware/B-05.pptx`），实际存在 `<前缀>apps/<应用 code>/` 下，应用之间互相看不到
- **大文件不经过平台**：上传时平台只签发限时的上传凭证，文件从应用服务端或用户浏览器直接传到七牛；下载给的是七牛的地址
- **私有空间**（推荐）：下载地址带签名和过期时间，过期就打不开，适合内部资料；公开空间的地址长期有效

## 管理员配置

「管理 → 系统设置 → 文件存储（七牛云）」：

| 项 | 说明 |
| --- | --- |
| 启用 | 关掉时应用调接口返回 503（`code: 1005`） |
| AccessKey / SecretKey | 七牛「个人中心 → 密钥管理」。建议用子账号的密钥，只授权这一个空间 |
| 存储空间 | 七牛里建的空间（bucket）名称 |
| 区域 | `z0` 华东-浙江 · `cn-east-2` 华东-浙江2 · `z1` 华北 · `z2` 华南 · `na0` 北美 · `as0` 新加坡 |
| 下载域名 | 绑定在这个空间上的域名，带 `https://`（七牛的测试域名 30 天后回收，正式用要绑自己的域名） |
| 私有空间 | 和七牛空间的「访问控制」保持一致 |
| 文件前缀 | 同一个空间给多套平台用时区分开，默认 `yihu-one/` |
| 单个文件上限 | 默认 500 MB |

填好保存后点「**测试连接**」：平台会传一个小文件、查信息、用下载域名取回比对、再删掉，哪一步不通会直接说原因（密钥错、空间不存在、下载域名没绑这个空间……）。

## 接口

鉴权都是应用凭证（`Authorization: Basic base64(client_id:client_secret)`），响应 `{ code: 0, data }`。

| 接口 | 说明 |
| --- | --- |
| `GET /api/open/storage` | `{ enabled, provider, private, maxUploadMB, root }` |
| `POST /api/open/storage/upload-token` | 上传凭证，见下 |
| `GET /api/open/storage/url?key=&expires=&filename=` | 下载地址 `{ url, expiresAt }`；`expires` 秒，默认 3600，最长 7 天；`filename` 给了浏览器就按这个名字下载 |
| `GET /api/open/storage/stat?key=` | `{ key, size, mime, hash, uploadedAt }`，不存在 404 |
| `GET /api/open/storage/list?prefix=&limit=&marker=` | `{ items: [...], marker }`，`marker` 不为空就还有下一页 |
| `DELETE /api/open/storage/object?key=` | 删除（不存在也算成功） |

`key` 的规则：相对路径，`/` 分目录，不能有 `.` `..` 路径段和控制字符，最长 512 个字符。中文文件名可以直接用。

### 上传

```http
POST {YH_API_URL}/api/open/storage/upload-token
{ "key": "courseware/B-05.pptx", "expires": 3600, "maxSizeMB": 100, "mime": "image/*", "overwrite": true }
```

```json
{ "code": 0, "data": {
  "uploadUrl": "https://up-z0.qiniup.com", "token": "…", "key": "courseware/B-05.pptx",
  "fullKey": "yihu-one/apps/trade-training/courseware/B-05.pptx", "expiresAt": "…", "maxSizeMB": 100
}}
```

拿到以后表单上传（`multipart/form-data`）：`POST uploadUrl`，字段 `token`、`key`（填 **`fullKey`**）、`file`。七牛返回 `{ key, hash, size, mime }`。

- `expires`：凭证有效期（秒），默认 1 小时，最长 1 天
- `maxSizeMB`：不超过管理员设的上限；`mime`：限定文件类型，如 `image/*`、`application/pdf`
- `overwrite: false`：同名文件已存在时七牛拒绝（614）

**浏览器直传**：用户在页面上传大文件时，应用服务端先按用户的权限决定 `key`，调接口拿凭证交给页面，页面直接传七牛，不用经过应用和平台。凭证只能写这一个 `key`。

## SDK

```js
const ws = new Workspace()
await ws.storage.put('courseware/B-05.pptx', buffer, { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
const url = await ws.storage.url('courseware/B-05.pptx', { filename: 'B-05 导向与重量平衡系统.pptx' })
res.redirect(url)                        // 下载：跳到签名地址
const buf = await ws.storage.get('courseware/B-05.pptx')
const { items } = await ws.storage.list({ prefix: 'courseware/' })
const t = await ws.storage.uploadToken({ key: `uploads/${user.id}/${name}`, maxSizeMB: 50 })   // 交给浏览器直传
```

Python：`ws.storage.put(key, data, mime=...)` / `get(key)` / `url(key, expires=, filename=)` / `upload_token(key, ...)` / `stat(key)` / `list(prefix=...)` / `remove(key)`。

## 建议

- **数据库里存 `key`，不要存下载地址**：私有空间的地址会过期，用的时候再调 `url()`；页面上的下载按钮指向应用自己的接口，接口里检查权限后 302 到签名地址
- 生成的文件（课件、报表）可以用内容的 hash 做文件名的一部分，改了就是新 key，不怕浏览器和 CDN 缓存旧文件
- 原始资料有「不能上云」要求的，不要放这里，放公司自己的文件服务器
