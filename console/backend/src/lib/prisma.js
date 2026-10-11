import { PrismaClient } from '@prisma/client'

// dev 下 --watch 热重载会重复实例化, 挂到 globalThis 复用
const prisma = globalThis.__prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma

export default prisma
