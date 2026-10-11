// 飞书 / 企业微信登录：客户端判断、授权地址（钉钉见 dingtalk.js）
// 都走 OAuth 授权码：跳到平台的授权页 → 回到 /auth/<平台>/callback?code&state → 后端换身份
// 在对应客户端里打开时授权页静默通过（免登），用户无感

export const isFeishu = () => /Lark|Feishu/i.test(navigator.userAgent)
export const isWecom = () => /wxwork/i.test(navigator.userAgent)

export const callbackUrl = provider => `${window.location.origin}/auth/${provider}/callback`

/** 飞书网页授权（浏览器里是扫码 / 账号确认页；飞书客户端里静默通过） */
export function feishuAuthUrl(cfg, state) {
  const q = new URLSearchParams({ client_id: cfg.appId, redirect_uri: callbackUrl('feishu'), response_type: 'code', state })
  return `${cfg.authorizeUrl || 'https://accounts.feishu.cn/open-apis/authen/v1/authorize'}?${q}`
}

/** 企业微信扫码登录（浏览器） */
export function wecomQrUrl(cfg, state) {
  const q = new URLSearchParams({
    login_type: 'CorpApp', appid: cfg.corpId, agentid: cfg.agentId, redirect_uri: callbackUrl('wecom'), state
  })
  return `https://login.work.weixin.qq.com/wwlogin/sso/login?${q}`
}

/** 企业微信客户端内静默授权（snsapi_base） */
export function wecomInAppUrl(cfg, state) {
  const q = new URLSearchParams({
    appid: cfg.corpId, redirect_uri: callbackUrl('wecom'), response_type: 'code', scope: 'snsapi_base', state, agentid: cfg.agentId
  })
  return `https://open.weixin.qq.com/connect/oauth2/authorize?${q}#wechat_redirect`
}

export const newState = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
