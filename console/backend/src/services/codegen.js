// 轻应用生成：员工用对话描述需求，模型生成单文件 HTML 页面（只能用平台 SDK window.yh），存成草稿
// 每次生成都存进草稿（版本记录里可以回到任何一次发布过的版本）；对话记录也存在草稿里，下次接着改
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { badRequest, forbidden, notFound } from '../lib/http.js'
import { get as getSetting } from './settings.js'
import { ensureDraft, normalizePermissions } from './studio.js'
import { allToolsFor } from '../agent/agents.js'
import { listModels, getLlmConfig, complete } from '../agent/llm.js'

export const SDK_DOC = `平台 SDK（页面里直接用全局对象 window.yh，不需要引入任何文件）：

await yh.ready                      // 必须先等它；之后可以用 yh.user / yh.app
yh.user                             // 当前用户 { id, name, avatar, depts: [{ id, name }] }
yh.app                              // 本应用 { id, name }

// 数据：本应用自己的数据表（表名自取，如 'bookings'），记录是任意 JSON 对象
await yh.db.list('表名', { where: { 字段: 值 }, scope: 'all' | 'mine' | 'shared', order: '-createdAt', limit: 100, offset: 0 })
                                    // → { list: [记录], total }；scope 默认 all = 我的私有记录 + 所有共享记录
await yh.db.get('表名', id)          // → 记录
await yh.db.add('表名', { ...数据 }, { shared: true })
                                    // → 记录；shared: true 表示这条所有用户都看得到（如预约、报名、公告），
                                    //   false/不传 表示只有自己看得到（如个人笔记）
await yh.db.update('表名', id, { ...完整数据 })   // → 记录；只能改自己创建的
await yh.db.remove('表名', id)
// 记录格式：{ id, data: {你存的对象}, shared, mine（是不是我创建的）, owner: { id, name }（创建人）, createdAt, updatedAt }

// AI（需要时才用）
await yh.ai.ask('提示词', { system: '可选的系统提示' })   // → 字符串

// 工具（调用平台上用户本来就能用的只读工具）
await yh.tools.call('工具名', { 参数 })                  // → 结果

yh.toast('保存成功')                 // 在页面顶部提示一句话；第二个参数可以是 'error'`

const SYSTEM = `你是「轻应用生成器」：根据用户的描述，生成一个在企业内部使用的单页小工具。

硬性要求（违反任何一条页面都跑不起来）：
1. 只输出一个完整的 HTML 文件，放在一个 \`\`\`html 代码块里。CSS 写在 <style>，JS 写在 <script>，全部内联。
2. 页面运行在沙箱里，**不能联网**：不能引用任何外部资源（CDN、字体、图片链接、fetch、XMLHttpRequest、WebSocket 都会被拦截）。图标用 emoji 或内联 SVG。
3. 数据只能用平台 SDK 保存，不要用 localStorage / sessionStorage / cookie（在沙箱里不能用）。
4. 不要写登录、账号、密码相关的界面：用户已经登录，身份用 yh.user。
5. 不要用 window.open、alert 之外的弹窗库、表单提交跳转；表单用 JS 处理（submit 时 event.preventDefault()）。
6. 所有 SDK 调用都是异步的，要 try/catch，出错时 yh.toast(错误信息, 'error')。
7. 界面用简体中文，简洁好看，适配手机和电脑（用 flex / grid、max-width 居中），主色 #2563eb，圆角 8px。

${SDK_DOC}

输出格式：先用一两句话说明做了什么（给用户看），然后给出完整的 \`\`\`html 代码块。修改时也要输出完整文件，不要只给片段。`

/** 从模型输出里取出 HTML */
export function extractHtml(text) {
  const fenced = /```html\s*([\s\S]*?)```/i.exec(text) || /```\s*(<!doctype[\s\S]*?)```/i.exec(text)
  let html = fenced ? fenced[1] : null
  if (!html) {
    const i = text.search(/<!doctype html|<html[\s>]/i)
    const j = text.toLowerCase().lastIndexOf('</html>')
    if (i >= 0 && j > i) html = text.slice(i, j + 7)
  }
  return html ? sanitizeHtml(html.trim()) : null
}

/** 去掉沙箱管不住的：自动跳转（meta refresh） */
export function sanitizeHtml(html) {
  return String(html).replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
}

/** 从代码里推断要申请的权限：用了 yh.ai 就要 AI；yh.tools.call('名字') 就要这些工具 */
export function inferPermissions(html, knownTools) {
  const tools = [...new Set([...html.matchAll(/yh\.tools\.call\(\s*['"`]([\w-]+)['"`]/g)].map(m => m[1]))].filter(n => knownTools.has(n))
  return { ai: /yh\.ai\.ask\s*\(/.test(html), tools }
}

async function pickModel(user) {
  const { codegenModel } = await getSetting('market')
  if (codegenModel) {
    const m = (await listModels(user)).find(x => x.name === codegenModel)
    if (m) return getLlmConfig({ modelId: m.id, user })
  }
  return getLlmConfig({ user })
}

/** 生成 / 修改一次。emit({ type: 'text', delta }) 实时推送；结束时 emit({ type: 'result', ... }) */
export async function generate(ctx, appId, { message }, emit, signal) {
  const text = String(message || '').trim()
  if (!text) throw badRequest('说说你想要什么')
  if (text.length > 4000) throw badRequest('描述太长了，最多 4000 字')
  const app = await prisma.app.findFirst({ where: { id: Number(appId), deletedAt: null, kind: 'LITE' } })
  if (!app) throw notFound('轻应用不存在')
  if (app.publisherId !== ctx.user.id) throw forbidden('只有发布者能修改这个轻应用')
  const cfg = await pickModel(ctx.user)
  if (!cfg || cfg.provider === 'OPENHEX') throw badRequest('平台还没配置可以写代码的模型，请管理员在「模型与 AI」里添加')

  const draft = await ensureDraft(ctx, app)
  const cur = draft.payload?.html || ''
  const chat = Array.isArray(draft.payload?.chat) ? draft.payload.chat : []
  const tools = await allToolsFor(ctx.user)
  const toolDoc = tools.filter(t => !t.write).slice(0, 40).map(t => `- ${t.name}：${t.description.slice(0, 120)}`).join('\n')
  const system = `${SYSTEM}\n\n当前用户能用的只读工具（yh.tools.call 的工具名，只在需求需要时用）：\n${toolDoc || '（没有）'}`
  const messages = [
    ...chat.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: cur ? `${text}\n\n（在下面这个现有页面的基础上修改，输出修改后的完整文件）\n\`\`\`html\n${cur}\n\`\`\`` : text }
  ]
  let out = ''
  const r = await complete({ ...cfg, maxTokens: Math.max(cfg.maxTokens || 0, 8192) }, {
    system, messages, signal, onText: (d) => { out += d; emit({ type: 'text', delta: d }) }
  })
  const full = r.content || out
  const html = extractHtml(full)
  const explain = full.replace(/```[\s\S]*?```/g, '').trim().slice(0, 1000) || (html ? '已生成页面。' : '')
  if (!html) {
    emit({ type: 'result', ok: false, message: '这次没有生成出页面代码，换个说法再试一次' })
    return
  }
  if (html.length > 400_000) {
    emit({ type: 'result', ok: false, message: '生成的页面太大了（超过 400KB），请让它精简一点' })
    return
  }
  const permissions = normalizePermissions('LITE', inferPermissions(html, new Set(tools.filter(t => !t.write).map(t => t.name))))
  const newChat = [...chat, { role: 'user', content: text }, { role: 'assistant', content: explain }].slice(-20)
  const v = await prisma.appVersion.update({ where: { id: draft.id }, data: { payload: { html, chat: newChat }, permissions } })
  audit(ctx, 'studio.lite.generate', { entityType: 'app', entityId: app.id, detail: { chars: html.length, model: cfg.name } })
  emit({ type: 'result', ok: true, versionId: v.id, permissions, explain })
}
