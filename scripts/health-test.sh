#!/bin/bash
# 公网入口巡检自测（不需要 Docker）：平台侧 yh public-check（agent 每 5 分钟跑的那个）和云服务器侧 cloud/healthcheck.sh。
# 用一个假的「平台」（/health 的状态码、应用域名的标记头可以随时改）和一个假的群机器人（记下收到的每条消息）。
# 改了 yh 的 public_watch / notify 或 cloud/healthcheck.sh 后跑一遍。
set -u
SRC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/yh-health-test.XXXXXX")"
PORT=$((20000 + RANDOM % 20000)); BOT=$((PORT + 1))
I="$T/inst"; mkdir -p "$I/platform" "$I/backups"
pass=0; fail=0
ok() { pass=$((pass + 1)); printf '\033[32m  ✅ %s\033[0m\n' "$1"; }
ng() { fail=$((fail + 1)); printf '\033[31m  ❌ %s\033[0m\n' "$1"; }
t() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else ng "$name"; fi; }
title() { printf '\n\033[36m━━ %s\033[0m\n' "$1"; }

# 假平台：/health 返回 $T/health 里的状态码；应用域名的请求（Host 以 apps. 开头）带不带 X-Yh-Apps 看 $T/apps-up；
# 控制台的 notify-config 指向假机器人（飞书格式）
cat > "$T/fake.mjs" <<'JS'
import http from 'node:http'
import fs from 'node:fs'
const [, , port, bot, dir] = process.argv
const read = (f, d) => { try { return fs.readFileSync(`${dir}/${f}`, 'utf8').trim() } catch { return d } }
http.createServer((req, res) => {
  req.resume(); req.on('end', () => {
    const host = String(req.headers.host || '')
    if (host.startsWith('apps.')) {
      if (read('apps-up', '1') === '1') res.setHeader('X-Yh-Apps', '1')
      res.writeHead(404); return res.end('not found')
    }
    if (req.url === '/health') { res.writeHead(Number(read('health', '200'))); return res.end('{}') }
    if (req.url.startsWith('/api/platform/notify-config')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ code: 0, data: { enabled: true, feishuWebhook: `http://127.0.0.1:${bot}/feishu` } }))
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"code":0,"data":{"ok":true}}')
  })
}).listen(Number(port), '127.0.0.1')
// 假群机器人：每条消息一行写进 messages.log（路径 + 查询串 + 正文）
http.createServer((req, res) => {
  let b = ''; req.on('data', d => { b += d }); req.on('end', () => {
    fs.appendFileSync(`${dir}/messages.log`, JSON.stringify({ url: req.url, body: b }) + '\n')
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"code":0,"errcode":0}')
  })
}).listen(Number(bot), '127.0.0.1')
JS
node "$T/fake.mjs" "$PORT" "$BOT" "$T" & FPID=$!
trap 'kill $FPID 2>/dev/null; wait $FPID 2>/dev/null; rm -rf "$T"' EXIT
sleep 1
msgs() { [ -f "$T/messages.log" ] && wc -l < "$T/messages.log" | tr -d ' ' || echo 0; }
last() { tail -1 "$T/messages.log" 2>/dev/null; }
yh() { (cd "$I" && /bin/bash ./yh "$@" 2>&1 | LC_ALL=C sed $'s/\033\\[[0-9;]*m//g'); }

cp "$SRC_ROOT/yh" "$I/yh"; cp "$SRC_ROOT/VERSION" "$I/VERSION" 2>/dev/null
env_base() {
  cat > "$I/yh.env" <<ENV
PLATFORM_MODE=production
PUBLIC_URL=http://one.localhost:$PORT
LOCAL_HTTP_PORT=$PORT
PLATFORM_TOKEN=tttttttttttttttttttttttttttttt
ENV
  rm -f "$I/backups/.public-watch" "$T/messages.log"; echo 200 > "$T/health"; echo 1 > "$T/apps-up"
}

title "平台侧：yh public-check（agent 每 5 分钟）"
env_base
out="$(yh public-check)"
t "入口正常：✓，不发通知" sh -c "echo '$out' | grep -q '✓ 平台入口' && [ $(msgs) = 0 ]"
echo 502 > "$T/health"
yh public-check >/dev/null
t "打不开 1 次：不发（可能只是抖一下）" [ "$(msgs)" = 0 ]
yh public-check >/dev/null
t "连续 2 次：发一条「打不开」" sh -c "[ $(msgs) = 1 ] && tail -1 $T/messages.log | grep -q '平台入口从公网打不开'"
t "  …用控制台配的飞书机器人，飞书文本格式" sh -c "tail -1 $T/messages.log | grep -q '\"url\":\"/feishu\"' && tail -1 $T/messages.log | grep -q 'msg_type'"
yh public-check >/dev/null; yh public-check >/dev/null
t "一直不通：不重复发" [ "$(msgs)" = 1 ]
echo 200 > "$T/health"
yh public-check >/dev/null
t "恢复：发一条「恢复了」" sh -c "[ $(msgs) = 2 ] && tail -1 $T/messages.log | grep -q '平台入口恢复了'"

title "平台侧：应用域名"
env_base; echo "APPS_URL=http://apps.localhost:$PORT" >> "$I/yh.env"
out="$(yh public-check)"
t "应用域名站点在：✓" sh -c "echo '$out' | grep -q '✓ 应用域名'"
echo 0 > "$T/apps-up"
yh public-check >/dev/null; yh public-check >/dev/null
t "应用域名到不了我们的站点（没有 X-Yh-Apps）：报警" sh -c "tail -1 $T/messages.log | grep -q '应用域名从公网打不开'"
t "  …平台入口那条照常（没混在一起）" sh -c "grep -q '^平台入口|ok|0|' $I/backups/.public-watch"

title "平台侧：不该巡检的实例"
env_base; sed -i.bak 's/^PLATFORM_MODE=.*/PLATFORM_MODE=test/' "$I/yh.env"; echo 502 > "$T/health"
yh public-check >/dev/null; yh public-check >/dev/null
t "测试模式：不巡检、不发" [ "$(msgs)" = 0 ]
env_base; sed -i.bak "s#^PUBLIC_URL=.*#PUBLIC_URL=http://localhost:$PORT#" "$I/yh.env"; echo 502 > "$T/health"
yh public-check >/dev/null; yh public-check >/dev/null
t "只在本机访问（localhost）：不巡检" [ "$(msgs)" = 0 ]

title "云服务器侧：cloud/healthcheck.sh"
C="$T/cloud"; mkdir -p "$C"; cp "$SRC_ROOT/cloud/healthcheck.sh" "$C/"
cloud_env() { # cloud_env <机器人地址> [钉钉密钥]
  cat > "$C/health.env" <<ENV
DOMAIN=one.localhost:$PORT
APPS_DOMAIN=apps.localhost:$PORT
ALERT_WEBHOOK=$1
ALERT_DINGTALK_SECRET=${2:-}
HEALTH_SCHEME=http
HEALTH_STATE_DIR=$C/state
ENV
  rm -rf "$C/state" "$T/messages.log"; echo 200 > "$T/health"; echo 1 > "$T/apps-up"
}
cloud_env "http://127.0.0.1:$BOT/open.feishu.cn/hook/x"
"$C/healthcheck.sh" --test >/dev/null
t "--test：发一条测试通知（飞书格式、JSON 合法）" sh -c "[ $(msgs) = 1 ] && tail -1 $T/messages.log | node -e 'const l=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")); const b=JSON.parse(l.body); process.exit(b.msg_type===\"text\" && b.content.text.includes(\"巡检已开启\") ? 0 : 1)'"
"$C/healthcheck.sh"; t "都正常：不发" [ "$(msgs)" = 1 ]
echo 502 > "$T/health"; "$C/healthcheck.sh"; "$C/healthcheck.sh"
t "平台打不开（比如平台机器关机）：连续 2 次后报警" sh -c "[ $(msgs) = 2 ] && tail -1 $T/messages.log | grep -q '平台入口打不开'"
"$C/healthcheck.sh"; t "  …不重复发" [ "$(msgs)" = 2 ]
echo 200 > "$T/health"; "$C/healthcheck.sh"
t "恢复：发「恢复了」" sh -c "tail -1 $T/messages.log | grep -q '平台入口恢复了'"
cloud_env "http://127.0.0.1:$BOT/oapi.dingtalk.com/robot/send?access_token=abc" "SECtest"
echo 502 > "$T/health"; "$C/healthcheck.sh"; "$C/healthcheck.sh"
t "钉钉：带加签参数（timestamp + sign）、钉钉文本格式" sh -c "tail -1 $T/messages.log | grep -q 'access_token=abc&timestamp=[0-9]*&sign=' && tail -1 $T/messages.log | grep -q 'msgtype'"
cloud_env "http://127.0.0.1:$BOT/qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k"
echo 0 > "$T/apps-up"; "$C/healthcheck.sh"; "$C/healthcheck.sh"
t "企业微信格式；应用域名单独报警" sh -c "tail -1 $T/messages.log | grep -q 'qyapi' && tail -1 $T/messages.log | grep -q '应用域名打不开'"

printf '\n通过 %s，失败 %s\n' "$pass" "$fail"
[ "$fail" = 0 ]
