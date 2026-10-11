// 兜底(无头安装): 还没有任何用户、且配了 BOOTSTRAP_ADMIN_PASSWORD 时，自动建初始管理员 admin
// 正式入口是浏览器初始化向导 /setup(见 services/setup.js)。已有用户后这里不再起作用
import prisma from './prisma.js'
import { hashPassword } from './auth.js'
import { audit } from './audit.js'

export async function bootstrap() {
  if (await prisma.user.count()) return
  const pw = process.env.BOOTSTRAP_ADMIN_PASSWORD
  if (!pw || pw.length < 8) {
    // 生产模式默认不配 BOOTSTRAP_ADMIN_PASSWORD，首次管理员由浏览器初始化向导 /setup 创建
    console.log('[yh-console] 等待浏览器初始化向导（/setup）创建管理员；无头安装可配置 BOOTSTRAP_ADMIN_PASSWORD')
    return
  }
  const u = await prisma.user.create({
    data: { username: 'admin', name: '管理员', passwordHash: hashPassword(pw), roles: ['ADMIN'] }
  })
  audit({ user: null, via: 'SYSTEM' }, 'bootstrap.admin', { entityType: 'user', entityId: u.id })
  console.log('[yh-console] 已创建初始管理员：账号 admin（密码见 yh init 的输出，或 yh passwd admin 重设）')
}
