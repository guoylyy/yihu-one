// 统一的状态/来源映射：所有页面共用，颜色保持一致
export const SOURCE = {
  WEB: { label: '网页', color: '#2563eb' },
  AI: { label: 'AI 助手', color: '#7c3aed' },
  MCP: { label: 'MCP 智能体', color: '#0891b2' },
  APP: { label: '应用', color: '#64748b' },
  SYSTEM: { label: '系统', color: '#94a3b8' }
}

export const APP_TYPE = {
  SSO: '统一认证',
  LINK: '链接'
}

export const ROLE_LABEL = {
  ADMIN: '管理员',
  DEVELOPER: '开发者',
  MEMBER: '成员'
}

// 平台运维操作（控制台下发，宿主机 yh agent 执行）
export const OP_KIND = {
  INSTALL: '安装',
  DEPLOY: '重新发布',
  START: '启动',
  STOP: '停用',
  RESTART: '重启',
  REMOVE: '移除',
  LOGS: '日志',
  UPGRADE: '平台升级',
  UPGRADE_CHECK: '检查更新'
}

export const OP_STATUS = {
  PENDING: { label: '排队中', type: 'info' },
  RUNNING: { label: '执行中', type: 'warning' },
  SUCCESS: { label: '成功', type: 'success' },
  FAILED: { label: '失败', type: 'danger' }
}

export const DEPLOY_RESULT = {
  成功: 'success',
  回滚: 'danger',
  中止: 'warning'
}

export const ACTION_STATUS = {
  PENDING: { label: '待确认', type: 'warning' },
  CONFIRMED: { label: '已执行', type: 'success' },
  CANCELLED: { label: '已取消', type: 'info' },
  FAILED: { label: '执行失败', type: 'danger' },
  EXPIRED: { label: '已过期', type: 'info' }
}

// 应用市场
export const APP_KIND = {
  AGENT: { label: 'AI 助手', color: '#7c3aed', desc: '写提示词、挑工具，做一个专门干某件事的 AI 助手', icon: '✦' },
  LITE: { label: '轻应用', color: '#0891b2', desc: '用对话描述需求，AI 生成一个小工具页面，数据存在平台', icon: '⚡' },
  EXTERNAL: { label: '外部应用', color: '#2563eb', desc: '已有系统的地址，接上统一登录和 AI 工具', icon: '🔗' },
  HOSTED: { label: '代码应用', color: '#475569', desc: 'Git 仓库，跑在平台上，推代码自动发布（需开发者角色）', icon: '🧩' },
  SKILL: { label: 'Skill', color: '#d97706', desc: '上传一个 Agent Skill（含 SKILL.md 的文件夹），分享给同事，在各自的 Agent 里用', icon: '📘' }
}

export const APP_SCOPE = {
  PRIVATE: { label: '仅自己', type: 'info' },
  SHARED: { label: '已分享', type: 'primary' },
  MARKET: { label: '已上架', type: 'success' }
}

export const VERSION_STATUS = {
  DRAFT: { label: '草稿', type: 'info' },
  PENDING: { label: '待审核', type: 'warning' },
  APPROVED: { label: '生效中', type: 'success' },
  REJECTED: { label: '被打回', type: 'danger' },
  SUPERSEDED: { label: '历史版本', type: 'info' },
  WITHDRAWN: { label: '已撤回', type: 'info' }
}
