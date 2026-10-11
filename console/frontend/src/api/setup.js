import { get, post } from './index'

export const setupApi = {
  status: () => get('/setup/status', null, { skipAuthRedirect: true }),
  submit: data => post('/setup', data, { skipAuthRedirect: true })
}
