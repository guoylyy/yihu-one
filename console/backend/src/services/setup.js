// 首次初始化：系统还没有任何用户时，浏览器向导创建初始管理员 + 站点信息 + 预置内容。
// 与 bootstrap.js 的分工：bootstrap 是「无头安装」的兜底（BOOTSTRAP_ADMIN_PASSWORD 存在时自动建 admin），
// 这里是正式的有 UI 入口；两者都只在「还没有任何用户」时生效，谁先谁生效。
import prisma from '../lib/prisma.js'
import { audit } from '../lib/audit.js'
import { hashPassword, checkPasswordStrength } from '../lib/auth.js'
import { badRequest, forbidden } from '../lib/http.js'

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,50}$/

export async function isReady() {
  return (await prisma.user.count()) > 0
}

export async function needsSetup() {
  return !(await isReady())
}

/** 预置一个通用 AI 助手：默认装到新用户工作台，并在市场可见 */
async function seedDefaultContent(admin) {
  const existing = await prisma.app.findUnique({ where: { code: 'assistant-default' } })
  if (existing) return
  const app = await prisma.app.create({
    data: {
      code: 'assistant-default',
      name: '工作助手',
      icon: '✦',
      description: '平台预置的通用 AI 助手，能调用你有权使用的应用工具',
      category: 'AI 助手',
      kind: 'AGENT',
      type: 'NONE',
      scope: 'MARKET',
      listed: true,
      trusted: true,
      isDefault: true,
      status: 'ACTIVE',
      publisherId: admin.id,
      ownerId: admin.id
    }
  })
  const v = await prisma.appVersion.create({
    data: {
      appId: app.id,
      version: 'v1',
      status: 'APPROVED',
      targetScope: 'MARKET',
      createdBy: admin.id,
      payload: {
        prompt: '你是企业工作台上的通用 AI 助手。用简洁、友好的中文回答；遇到能调用工具解决的事情（查资料、查数据、执行操作）优先使用工具。不确定时如实说明。',
        tools: [],
        modelId: null,
        starters: ['你能帮我做什么？', '我有哪些应用？'],
        greeting: '你好，我是你的工作助手，有什么可以帮你？'
      }
    }
  })
  await prisma.app.update({ where: { id: app.id }, data: { liveVersionId: v.id } })
}

/** 向导提交：{ admin: { username, name, password }, site: { workspaceName, workspaceSubtitle } } */
export async function setup(body = {}) {
  if (await isReady()) throw forbidden('系统已完成初始化，无需再次执行向导')

  const admin = body.admin || {}
  const username = String(admin.username || '').trim()
  const name = String(admin.name || '').trim()
  const password = String(admin.password || '')
  if (!USERNAME_RE.test(username)) throw badRequest('账号须为 2~50 位，只能用字母、数字、下划线、点、短横线')
  if (!name) throw badRequest('请填写姓名')
  if (name.length > 50) throw badRequest('姓名最长 50 字')
  checkPasswordStrength(password)

  const site = body.site || {}
  const general = {}
  const workspaceName = String(site.workspaceName || '').trim()
  if (workspaceName) general.workspaceName = workspaceName.slice(0, 60)
  if (site.workspaceSubtitle !== undefined) general.workspaceSubtitle = String(site.workspaceSubtitle || '').trim().slice(0, 60)

  const user = await prisma.user.create({
    data: { username, name, passwordHash: hashPassword(password), roles: ['ADMIN'] }
  })

  // 站点信息直接写 systemSetting（general 组没有密钥字段）
  if (Object.keys(general).length) {
    const row = await prisma.systemSetting.findUnique({ where: { key: 'general' } })
    await prisma.systemSetting.upsert({
      where: { key: 'general' },
      create: { key: 'general', value: { ...general }, updatedBy: user.id },
      update: { value: { ...(row?.value || {}), ...general }, updatedBy: user.id }
    })
  }

  await seedDefaultContent(user)

  audit({ user, via: 'WEB', ip: null }, 'setup.complete', { entityType: 'user', entityId: user.id, detail: { username } })
  return { ok: true }
}
