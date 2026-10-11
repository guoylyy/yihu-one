---
title: 轻应用 SDK
category: 应用能力
order: 23
summary: 轻应用页面里的 window.yh：用户、数据、AI、工具；沙箱的限制
updated: 2026-09-30
---

# 轻应用 SDK

轻应用是一个单文件 HTML 页面，由平台托管，跑在**沙箱**里。页面里有全局对象 `window.yh`，这是它和平台打交道的唯一方式。一般由 AI 生成，你也可以在编辑页「代码」里直接改。

## API

```js
await yh.ready                       // 先等它
yh.user                              // 当前用户 { id, name, avatar, depts: [{ id, name }] }
yh.app                               // 本应用 { id, name }

// 数据：本应用自己的数据表，表名自取，记录是任意 JSON 对象（单条不超过 20KB）
await yh.db.list('bookings', { where: { room: '大会议室' }, scope: 'all', order: '-createdAt', limit: 100, offset: 0 })
// → { list: [记录], total }
await yh.db.get('bookings', id)
await yh.db.add('bookings', { room: '大会议室', date: '2026-10-01' }, { shared: true })
await yh.db.update('bookings', id, { ...完整数据 })
await yh.db.remove('bookings', id)
// 记录：{ id, data, shared, mine, owner: { id, name }, createdAt, updatedAt }

await yh.ai.ask('把这段话总结成三点：…', { system: '你是…' })   // → 字符串
await yh.tools.call('get_my_profile', {})                        // → 结果
yh.toast('保存成功')                                              // 第二个参数 'error' 为错误提示
```

| 参数 | 说明 |
| --- | --- |
| `shared` | `true`：本应用所有用户都看得到（预约、报名、公告）；不传：只有自己看得到（个人笔记） |
| `scope` | `all`（默认）= 我的私有记录 + 所有共享记录；`mine` = 我创建的；`shared` = 共享的 |
| `where` | 按数据字段相等过滤，最多 5 个字段 |
| `order` | `createdAt` / `updatedAt` / `id`，前面加 `-` 为倒序 |

**只能改、删自己创建的记录**（发布者可以改所有记录）。

## 权限

- 数据：所有轻应用都能用，只能读写**本应用**的数据
- `yh.ai`、`yh.tools`：要在编辑页「权限」里申请（AI 生成时会按代码自动勾选）。同事第一次打开时会看到并确认；应用更新后申请变多，会重新确认
- 工具只能用**只读**的，并且以当前用户自己的身份和权限执行
- `yh.ai` 按人每天限额（管理员设置），所有轻应用合计

## 沙箱的限制

页面按不可信代码对待，下面这些在沙箱里都**做不到**（浏览器直接拦截）：

- 联网：`fetch`、`XMLHttpRequest`、WebSocket、外链图片 / 脚本 / 字体 / CSS 都会被拦下。图标用 emoji 或内联 SVG，图片用 data URL
- 读登录凭证、cookie、`localStorage`；访问平台页面
- 打开新窗口、跳转平台页面、`<meta http-equiv="refresh">` 自动跳转（会被去掉）
- 表单直接提交到别的地址（用 JS 处理 submit 并 `preventDefault()`）

需要后端、数据库、定时任务、对接外部系统的，做成[代码应用](/dev/deploy)。
