// 自测用的模拟身份平台：飞书开放平台 + 企业微信的登录相关接口（selftest.sh 把它跑在临时容器里）
// 授权码约定：good → 张三；good2 → 李四（手机号和平台里已有用户一致）；outsider（企业微信）→ 非企业成员；其他 → 无效
import http from 'node:http'
const USERS = {
  good: { open_id: 'ou_zhang', union_id: 'on_zhang', name: '飞书·张三', mobile: '+8613900000001', email: 'zhang@example.com', wecom: 'zhangsan' },
  good2: { open_id: 'ou_li', union_id: 'on_li', name: '飞书·李四', mobile: '+8613900000002', email: null, wecom: 'lisi' }
}
const tokens = new Map() // access_token → 用户
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    console.log(JSON.stringify({ path: u.pathname }))
    // ---- 飞书 ----
    if (u.pathname === '/open-apis/authen/v2/oauth/token') {
      const b = JSON.parse(body || '{}')
      if (b.client_id !== 'cli_test' || b.client_secret !== 'fs_secret') return json({ code: 20002, error: 'invalid_client', error_description: 'client_secret 错误' })
      const who = USERS[b.code]
      if (!who) return json({ code: 20050, error: 'invalid_grant', error_description: '授权码无效' })
      const t = `fs_${b.code}_${Date.now()}`
      tokens.set(t, who)
      return json({ code: 0, access_token: t, expires_in: 7200, token_type: 'Bearer' })
    }
    if (u.pathname === '/open-apis/authen/v1/user_info') {
      const who = tokens.get((req.headers.authorization || '').replace('Bearer ', ''))
      if (!who) return json({ code: 99991663, msg: 'token 无效' })
      return json({ code: 0, data: { open_id: who.open_id, union_id: who.union_id, name: who.name, mobile: who.mobile, email: who.email } })
    }
    // ---- 企业微信 ----
    if (u.pathname === '/cgi-bin/gettoken') {
      if (u.searchParams.get('corpid') !== 'ww_test' || u.searchParams.get('corpsecret') !== 'wc_secret') return json({ errcode: 40001, errmsg: 'invalid credential' })
      return json({ errcode: 0, access_token: 'wc_token', expires_in: 7200 })
    }
    if (u.pathname === '/cgi-bin/auth/getuserinfo') {
      if (u.searchParams.get('access_token') !== 'wc_token') return json({ errcode: 40014, errmsg: 'invalid access_token' })
      const code = u.searchParams.get('code')
      if (code === 'outsider') return json({ errcode: 0, openid: 'o_outsider' })
      const who = USERS[code]
      return who ? json({ errcode: 0, userid: who.wecom }) : json({ errcode: 40029, errmsg: 'invalid code' })
    }
    if (u.pathname === '/cgi-bin/user/get') {
      const who = Object.values(USERS).find(x => x.wecom === u.searchParams.get('userid'))
      return who ? json({ errcode: 0, userid: who.wecom, name: `企微·${who.name.slice(3)}`, mobile: who.mobile.replace('+86', '') }) : json({ errcode: 60111, errmsg: 'userid not found' })
    }
    res.writeHead(404); res.end('not found')
  })
}).listen(18998, () => console.log(JSON.stringify({ ready: true })))
