import { get, post } from './index'

export const authApi = {
  config: () => get('/auth/config', null, { skipAuthRedirect: true }),
  scanLogin: authCode => post('/auth/dingtalk/scan', { authCode }, { skipAuthRedirect: true }),
  feishuLogin: (code, redirectUri) => post('/auth/feishu', { code, redirectUri }, { skipAuthRedirect: true }),
  wecomLogin: code => post('/auth/wecom', { code }, { skipAuthRedirect: true }),
  inappLogin: code => post('/auth/dingtalk/inapp', { code }, { skipAuthRedirect: true }),
  devUsers: () => get('/auth/dev/users', null, { skipAuthRedirect: true }),
  devLogin: userId => post('/auth/dev/login', { userId }, { skipAuthRedirect: true }),
  passwordLogin: (username, password) => post('/auth/password', { username, password }, { skipAuthRedirect: true }),
  me: () => get('/me')
}
