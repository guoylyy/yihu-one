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

// 老板助理：给管理层的预置 AI 助手（docs/设计-老板应用.md）。新装时随向导建好，老平台升级后控制台启动时补建
export const BOSS_AGENT_CODE = 'boss-assistant'
const BOSS_PROMPT = [
  '你是老板（公司管理层）的 AI 助理。你能读平台上所有应用的数据和公司知识库，帮老板快速掌握公司状况、做决定。',
  '回答规则：',
  '1. 先给结论，再给支撑的数字和事实；数字带单位，注明来自哪个应用。',
  '2. 问公司整体情况、今天要关注什么、有什么风险时，先调用 get_business_overview 拿各应用的关键指标、变化与风险、待决策事项，再按需查具体应用。',
  '3. 不知道就说不知道，绝不编造数字；数据不全时说明缺了哪块。',
  '4. 你不能替老板改任何数据。老板要做的决定（审批、回复、指派），给出建议和对应应用的入口链接，由他自己确认。',
  '5. 简洁：手机上一屏能看完；多条用列表，对比用表格。'
].join('\n')

/** 建老板助理（已经有就不动，管理员改过的设定、可见范围都保留） */
export async function ensureBossAssistant() {
  if (await prisma.app.findUnique({ where: { code: BOSS_AGENT_CODE } })) return
  const admin = await prisma.user.findFirst({ where: { deletedAt: null, roles: { array_contains: ['ADMIN'] } }, orderBy: { id: 'asc' } })
  if (!admin) return // 还没初始化：向导建管理员时再建
  const app = await prisma.app.create({
    data: {
      code: BOSS_AGENT_CODE, name: '老板助理', icon: 'svg:chart', iconColor: '#1c1917',
      description: '给管理层的 AI 助理：随时问公司状况、风险和待决定的事，每天推送经营简报',
      category: 'AI 助手', kind: 'AGENT', type: 'NONE', scope: 'MARKET', listed: true, trusted: true, isDefault: false, status: 'ACTIVE',
      // 默认只给管理员和部门负责人（LEADER），管理员可以在创作中心里改
      visibility: { roles: ['ADMIN', 'LEADER'] },
      publisherId: admin.id, ownerId: admin.id
    }
  })
  const v = await prisma.appVersion.create({
    data: {
      appId: app.id, version: 'v1', status: 'APPROVED', targetScope: 'MARKET', createdBy: admin.id,
      payload: {
        prompt: BOSS_PROMPT, tools: [], allReadOnly: true, modelId: null,
        starters: ['今天公司有什么需要我关注的？', '这个月哪些项目有风险？', '有哪些事等我拍板？', '帮我生成一份经营简报'],
        greeting: '您好，我是您的老板助理。可以问我公司现在的状况、风险和需要您决定的事；也可以让我每天早上把经营简报推到您的手机上。'
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
  await ensureBossAssistant()

  audit({ user, via: 'WEB', ip: null }, 'setup.complete', { entityType: 'user', entityId: user.id, detail: { username } })
  return { ok: true }
}
