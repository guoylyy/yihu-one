import prisma from './prisma.js'

/**
 * 审计留痕。via: WEB / AI / MCP / APP / SYSTEM
 * 异步写, 失败只打日志, 不影响主流程
 */
export function audit(ctx, action, { entityType, entityId, detail } = {}) {
  prisma.auditLog.create({
    data: {
      actorId: ctx?.user?.id ?? null,
      via: ctx?.via || 'WEB',
      action,
      entityType: entityType || null,
      entityId: entityId != null ? String(entityId) : null,
      detail: detail ?? undefined,
      ip: ctx?.ip || null
    }
  }).catch(e => console.error('[audit]', e.message))
}
