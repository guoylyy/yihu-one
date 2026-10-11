import { get, post } from './index'

export const ssoApi = {
  appInfo: clientId => get('/sso/app-info', { client_id: clientId }),
  consent: clientId => get('/sso/consent', { client_id: clientId }),
  authorize: data => post('/sso/authorize', data)
}
