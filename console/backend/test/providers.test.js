// 飞书 / 企业微信登录客户端：用假的 fetch 验证请求和结果解析（不连真平台、不需要数据库）
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars'
process.env.DATABASE_URL ||= 'mysql://u:p@127.0.0.1:1/none'

const feishu = await import('../src/lib/feishu.js')
const wecom = await import('../src/lib/wecom.js')

let calls = []
function stub(routes) {
  calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k))
    if (!hit) throw new Error(`没有模拟 ${url}`)
    const body = typeof hit[1] === 'function' ? hit[1](String(url), init) : hit[1]
    return { json: async () => body }
  }
}
beforeEach(() => { calls = [] })

test('飞书：授权码换用户，手机号去掉 +86', async () => {
  stub({
    '/authen/v2/oauth/token': (url, init) => {
      const b = JSON.parse(init.body)
      assert.equal(b.grant_type, 'authorization_code')
      assert.equal(b.client_id, 'cli_x')
      assert.equal(b.redirect_uri, 'https://one/auth/feishu/callback')
      return { code: 0, access_token: 'u-token' }
    },
    '/authen/v1/user_info': (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer u-token')
      return { code: 0, data: { open_id: 'ou_1', union_id: 'on_1', name: '张三', mobile: '+8613800000000', enterprise_email: 'z@corp.com' } }
    }
  })
  const u = await feishu.userByCode({ appId: 'cli_x', appSecret: 's' }, 'c1', 'https://one/auth/feishu/callback')
  assert.deepEqual(u, { openId: 'ou_1', unionId: 'on_1', userId: null, name: '张三', avatar: null, mobile: '13800000000', email: 'z@corp.com' })
})

test('飞书：授权码无效 / 没配置时报错', async () => {
  stub({ '/authen/v2/oauth/token': { code: 20050, error: 'invalid_grant', error_description: '授权码已过期' } })
  await assert.rejects(feishu.userByCode({ appId: 'a', appSecret: 'b' }, 'bad', 'x'), /授权码已过期/)
  await assert.rejects(feishu.userByCode({}, 'c', 'x'), /飞书未配置/)
})

test('飞书：通讯录部门与成员拉取（tenant_access_token 缓存 + 分页）', async () => {
  let tokenCalls = 0
  stub({
    '/auth/v3/tenant_access_token/internal': (url, init) => {
      tokenCalls++
      const b = JSON.parse(init.body)
      assert.equal(b.app_id, 'cli_x')
      return { code: 0, tenant_access_token: 't-token', expire: 3600 }
    },
    '/contact/v3/departments/0/children': url => ({
      code: 0,
      data: { items: [{ open_department_id: 'od_1', name: '技术部', parent_open_department_id: '0' }, { open_department_id: 'od_dead', name: '已删部门', status: { is_deleted: true } }] }
    }),
    '/contact/v3/departments/od_1/children': url => ({ code: 0, data: { items: [] } }),
    '/contact/v3/users/find_by_department': url => {
      assert.match(url, /user_id_type=open_id/)
      if (url.includes('department_id=0&') || url.includes('department_id=0%')) return { code: 0, data: { items: [{ open_id: 'ou_boss', name: '老板', enterprise_email: 'b@corp.com', leader_user_id: 'ou_boss' }] } }
      if (url.includes('page_token=p2')) return { code: 0, data: { items: [{ open_id: 'ou_2', name: '李四', mobile: '+8613900000001', job_number: 'E002', job_title: '工程师', leader_user_id: 'ou_boss', avatar: { avatar_240: 'https://a/240' } }] } }
      return { code: 0, data: { has_more: true, page_token: 'p2', items: [{ open_id: 'ou_1', name: '张三', union_id: 'on_1', department_ids: ['od_1'] }] } }
    }
  })
  const c = { appId: 'cli_x', appSecret: 's' }
  const depts = await feishu.listAllDepartments(c)
  assert.deepEqual(depts, [{ deptId: 'od_1', name: '技术部', parentId: '0' }])
  const users = await feishu.listDeptUsers('od_1', c)
  assert.equal(users.length, 2)
  assert.deepEqual(users[0], { openId: 'ou_1', unionId: 'on_1', name: '张三', avatar: null, mobile: null, email: null, jobNumber: null, title: null, leaderUserId: null })
  assert.equal(users[1].mobile, '13900000001')
  assert.equal(users[1].email, null)
  assert.equal(users[1].jobNumber, 'E002')
  assert.equal(users[1].title, '工程师')
  assert.equal(users[1].leaderUserId, 'ou_boss')
  assert.equal(tokenCalls, 1, 'token 应只取一次（缓存）')
  await assert.rejects(feishu.listAllDepartments({}), /飞书未配置/)
})

test('飞书：接口报错时给出可读信息', async () => {
  stub({
    '/auth/v3/tenant_access_token/internal': { code: 0, tenant_access_token: 't', expire: 3600 },
    '/contact/v3/departments/0/children': { code: 230002, msg: '权限校验失败' }
  })
  await assert.rejects(feishu.listAllDepartments({ appId: 'cli_x', appSecret: 's' }), /权限校验失败/)
})

test('飞书授权地址', () => {
  const url = new URL(feishu.authorizeUrl('cli_x', 'https://one/auth/feishu/callback', 's1'))
  assert.equal(url.origin + url.pathname, 'https://accounts.feishu.cn/open-apis/authen/v1/authorize')
  assert.equal(url.searchParams.get('client_id'), 'cli_x')
  assert.equal(url.searchParams.get('state'), 's1')
})

test('企业微信：授权码换成员，access_token 缓存', async () => {
  let tokenCalls = 0
  stub({
    '/cgi-bin/gettoken': () => { tokenCalls++; return { errcode: 0, access_token: 'at', expires_in: 7200 } },
    '/cgi-bin/auth/getuserinfo': url => (url.includes('code=outsider') ? { errcode: 0, openid: 'o1' } : { errcode: 0, userid: 'zhangsan' }),
    '/cgi-bin/user/get': { errcode: 0, name: '张三', mobile: '13800000000', biz_mail: 'z@corp.com' }
  })
  const c = { corpId: 'ww1', agentId: '1000002', secret: 's' }
  assert.deepEqual(await wecom.userByCode(c, 'c1'), { userId: 'zhangsan', name: '张三', avatar: null, mobile: '13800000000', email: 'z@corp.com' })
  await wecom.userByCode(c, 'c2')
  assert.equal(tokenCalls, 1, '第二次应复用 access_token')
  await assert.rejects(wecom.userByCode(c, 'outsider'), /不是本企业的成员/)
})

test('企业微信：拿不到姓名时用 userid；没配置时报错', async () => {
  stub({
    '/cgi-bin/gettoken': { errcode: 0, access_token: 'at2', expires_in: 7200 },
    '/cgi-bin/auth/getuserinfo': { errcode: 0, userid: 'lisi' },
    '/cgi-bin/user/get': { errcode: 60011, errmsg: 'no privilege' }
  })
  const u = await wecom.userByCode({ corpId: 'ww2', agentId: '1', secret: 's2' }, 'c')
  assert.equal(u.name, 'lisi')
  await assert.rejects(wecom.userByCode({ corpId: 'ww2' }, 'c'), /企业微信未配置/)
})
