// 统一响应与错误。业务层抛 AppError, 路由用 wrap 包一层即可
export class AppError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code || status
  }
}

export const badRequest = (msg) => new AppError(400, msg, 1001)
export const forbidden = (msg = '没有权限执行此操作') => new AppError(403, msg, 1003)
export const notFound = (msg = '记录不存在') => new AppError(404, msg, 1004)

export const ok = (res, data = null) => res.json({ code: 0, data })

/** 包装 async 路由, 统一把异常转成 { code, message } */
export const wrap = (fn) => async (req, res, next) => {
  try {
    const data = await fn(req, res, next)
    if (!res.headersSent && data !== undefined) ok(res, data)
  } catch (e) {
    next(e)
  }
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ code: err.code, message: err.message })
  }
  if (err?.name === 'ZodError') {
    return res.status(400).json({ code: 1001, message: '参数错误: ' + err.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ') })
  }
  console.error('[error]', req.method, req.originalUrl, err)
  res.status(500).json({ code: 9001, message: err.message || '服务器错误' })
}

export function paging(q) {
  const page = Math.max(1, parseInt(q.page) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}
