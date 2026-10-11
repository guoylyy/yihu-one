#!/bin/bash
# 隧道配置自测：yh.env 的 EXTRA_TUNNELS → platform/frpc.toml 的渲染、幂等、向后兼容、配错报错、配置变化时重启 frpc、yh doctor
#
#   ./scripts/tunnel-test.sh
#
# 不需要 Docker 和真实隧道，也不碰本机正在运行的平台：在临时目录里放一份 yh，docker 换成假的（只记录调用），
# 控制台换成一个只会应答的假服务。改了 yh 的 render_frpc / extra_tunnels 或 doctor 的隧道检查后跑一遍。
# 真实链路（frps ↔ frpc ↔ 宿主机服务）的验证办法见 docs/发布方式.md「把内网独立服务挂到子域名」。
set -uo pipefail

SRC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(cd "${TMPDIR:-/tmp}" && pwd)/yh-tunnel-test"; I="$T/inst"; PORT=18996
for c in node curl; do command -v "$c" >/dev/null 2>&1 || { echo "缺少 $c"; exit 1; }; done
curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" && { echo "端口 $PORT 被占用"; exit 1; }
rm -rf "$T"; mkdir -p "$T/bin" "$I/platform" "$T/shim"
export SHIM="$T/shim" PATH="$T/bin:$PATH"

pass=0; fail=0
ok() { pass=$((pass + 1)); printf '\033[32m  ✅ %s\033[0m\n' "$1"; }
ng() { fail=$((fail + 1)); printf '\033[31m  ❌ %s\033[0m\n' "$1"; }
t() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else ng "$name"; fi; }
nt() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ng "$name"; else ok "$name"; fi; }
title() { printf '\n\033[36m━━ %s\033[0m\n' "$1"; }
yh() { (cd "$I" && /bin/bash ./yh "$@" 2>&1 | LC_ALL=C sed $'s/\033\\[[0-9;]*m//g'; exit "${PIPESTATUS[0]}"); }
said() { grep -q -- "$1" <<<"$out"; }
F="$I/platform/frpc.toml"
proxies() { grep -c '^\[\[proxies\]\]' "$F"; }
restarts() { grep -c '^docker restart yh-frpc' "$SHIM/docker.log" 2>/dev/null; }

# ---- 假 docker：记下调用；frpc 在不在运行、日志、内网服务通不通由 $SHIM 下的文件决定
cat > "$T/bin/docker" <<'SH'
#!/bin/bash
echo "docker $*" >> "$SHIM/docker.log"
case "$*" in
  "ps -q --filter name=^yh-frpc$ --filter status=running"|"ps --filter name=^yh-frpc$ --filter status=running -q") [ -f "$SHIM/frpc-running" ] && echo abc123;;
  logs*yh-frpc) cat "$SHIM/frpc.log" 2>/dev/null;;
  "exec yh-frpc nc -z -w 3 "*) grep -qx "$7:$8" "$SHIM/reachable" 2>/dev/null || exit 1;;
esac
exit 0
SH
chmod +x "$T/bin/docker"

# ---- 假控制台：什么都答 200
cat > "$T/console.mjs" <<'JS'
import http from 'node:http'
http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"code":0,"data":{"ok":true}}') }) }).listen(Number(process.argv[2]), '127.0.0.1')
JS
node "$T/console.mjs" "$PORT" & CPID=$!
trap 'kill $CPID 2>/dev/null' EXIT
sleep 1

cp "$SRC_ROOT/yh" "$I/yh"; cp "$SRC_ROOT/VERSION" "$I/VERSION" 2>/dev/null
cp "$SRC_ROOT/platform/compose.yml" "$SRC_ROOT/platform/Caddyfile" "$I/platform/"
env_base() {
  cat > "$I/yh.env" <<ENV
PLATFORM_MODE=production
PUBLIC_URL=http://one.localhost:$PORT
LOCAL_HTTP_PORT=$PORT
MYSQL_ROOT_PASSWORD=x
CONSOLE_DB_PASSWORD=x
CONSOLE_JWT_SECRET=xxxxxxxxxxxxxxxx
CONSOLE_SECRET_KEY=xxxxxxxxxxxxxxxx
PLATFORM_TOKEN=tttttttttttttttttttttttttttttt
FRP_SERVER_ADDR=1.2.3.4
FRP_TOKEN=frp-token
ENV
  [ $# -gt 0 ] && echo "EXTRA_TUNNELS=\"$1\"" >> "$I/yh.env" # 值里有空格时要加引号（yh.env 是按 shell 语法读的）
  : > "$SHIM/docker.log"
}

title "不配 EXTRA_TUNNELS：和改造前一样"
env_base
out="$(yh start)"; rc=$?
cat > "$T/legacy.toml" <<'TOML'
# yh 生成，勿手改（改 yh.env 后执行 yh start）
serverAddr = "1.2.3.4"
serverPort = 7000
auth.method = "token"
auth.token = "frp-token"
loginFailExit = false
log.to = "console"
log.level = "info"

[[proxies]]
name = "yh-platform"
type = "http"
localIP = "yh-caddy"
localPort = 80
customDomains = ["one.localhost"]
TOML
t "yh start 成功" [ "$rc" = 0 ]
t "frpc.toml 与改造前逐字节相同（只有 yh-platform 一条）" cmp -s "$F" "$T/legacy.toml"

title "配两条额外隧道"
env_base "t1.localhost=host.docker.internal:3005, T2.localhost=192.168.1.20:8080"
touch "$SHIM/frpc-running"
out="$(yh start)"; rc=$?
t "yh start 成功" [ "$rc" = 0 ]
t "平台那条原样在最前面" sh -c "head -15 $F | cmp -s - $T/legacy.toml"
t "一共 3 条 proxy" [ "$(proxies)" = 3 ]
t "第一条：名字由域名派生、目标拆成 localIP + localPort" sh -c "grep -A5 'name = \"yh-extra-t1-localhost\"' $F | tr '\n' ' ' | grep -q 'type = \"http\" localIP = \"host.docker.internal\" localPort = 3005 customDomains = \[\"t1.localhost\"\]'"
t "第二条：域名转小写，目标是内网 IP" sh -c "grep -A5 'name = \"yh-extra-t2-localhost\"' $F | tr '\n' ' ' | grep -q 'localIP = \"192.168.1.20\" localPort = 8080 customDomains = \[\"t2.localhost\"\]'"
t "配置变了且 frpc 在运行：重启一次 frpc" [ "$(restarts)" = 1 ]
t "  …并提示已重启" said '已重启隧道客户端'
cp "$F" "$T/first.toml"
out="$(yh start)"
t "再 yh start 一次：文件一模一样（幂等）" cmp -s "$F" "$T/first.toml"
t "  …没变化就不重启 frpc" [ "$(restarts)" = 1 ]
t "配置文件权限 600" [ "$(ls -l "$F" | cut -c1-10)" = "-rw-------" ]

title "去掉一条 / frpc 没在运行"
env_base "t1.localhost=host.docker.internal:3005"; rm -f "$SHIM/frpc-running"
out="$(yh start)"
t "去掉的那条从配置里消失，不残留" sh -c "[ \"\$(grep -c '^\[\[proxies\]\]' $F)\" = 2 ] && ! grep -q t2 $F"
t "frpc 本来没在运行（由 compose 新建）：不额外重启" [ "$(restarts)" = 0 ]

title "配错：报出来、跳过那一条，平台和其余条目照常"
env_base "t1.localhost=host.docker.internal:3005,no-equals.localhost,http://bad.localhost/x=host.docker.internal:3005,t3.localhost=host.docker.internal,t4.localhost=host.docker.internal:99999,one.localhost=host.docker.internal:3005,t1.localhost=10.0.0.1:80,t5.localhost=bad host:80x"
out="$(yh start)"; rc=$?
t "平台照常启动" [ "$rc" = 0 ]; t "  …控制台正常" said '控制台正常'
t "缺 = 的报错" said '「no-equals.localhost」缺少 ='
t "域名不合法的报错" said '域名「http://bad.localhost/x」不合法'
t "目标缺端口的报错" said 't3.localhost 的目标「host.docker.internal」不对'
t "端口越界的报错" said 't4.localhost 的目标「host.docker.internal:99999」不对'
t "占用平台域名的报错" said 'one.localhost 是平台自己的域名'
t "重复域名的报错" said 't1.localhost 写了两次'
t "只渲染了对的那一条" sh -c "[ \"\$(grep -c '^\[\[proxies\]\]' $F)\" = 2 ] && grep -q 'localPort = 3005' $F && ! grep -q '10.0.0.1' $F"
t "平台那条没被动" sh -c "head -15 $F | cmp -s - $T/legacy.toml"

title "没配隧道 / 测试模式"
env_base "t1.localhost=host.docker.internal:3005"; sed -i.bak '/^FRP_/d' "$I/yh.env"
out="$(yh start)"; t "没配隧道：提示 EXTRA_TUNNELS 没生效" said 'EXTRA_TUNNELS 没有生效：还没配隧道'
env_base "t1.localhost=host.docker.internal:3005"; sed -i.bak 's/^PLATFORM_MODE=.*/PLATFORM_MODE=test/' "$I/yh.env"
out="$(yh start)"; t "测试模式：提示 EXTRA_TUNNELS 没生效" said 'EXTRA_TUNNELS 没有生效：测试模式不连隧道'

title "应用独立域名（APPS_URL）"
SITE="$I/platform/caddy/apps"
env_base; echo "APPS_URL=http://apps.localhost:$PORT/" >> "$I/yh.env"
out="$(yh start)"; rc=$?
t "yh start 成功" [ "$rc" = 0 ]
t "隧道：平台那条同时带上控制台和应用两个域名" grep -q 'customDomains = \["one.localhost", "apps.localhost"\]' "$F"
t "生成应用域名站点，只引入应用路由（*.app）" sh -c "grep -q '^http://apps.localhost {' $SITE/apps.site && grep -q 'import /etc/caddy/apps/\*.app' $SITE/apps.site"
t "  …应用域名上没有控制台（兜底是 404 页，不转给 yh-console）" sh -c "grep -q 'respond .* 404' $SITE/apps.site && ! grep -q 'yh-console' $SITE/apps.site"
t "控制台域名的老地址跳到应用域名（302，末尾的 / 去掉了）" grep -q "redir http://apps.localhost:$PORT{uri} 302" "$SITE/_apps-redirect.caddy"
env_base "apps.localhost=host.docker.internal:3005"; echo "APPS_URL=http://apps.localhost:$PORT" >> "$I/yh.env"
out="$(yh start)"
t "EXTRA_TUNNELS 不能占用应用域名" said 'apps.localhost 是平台自己的域名'
env_base; echo "APPS_URL=http://one.localhost:$PORT" >> "$I/yh.env"
out="$(yh start)"; rc=$?
t "APPS_URL 和 PUBLIC_URL 同一个域名：拒绝启动" sh -c "[ $rc != 0 ] && grep -q '不能和 PUBLIC_URL 同一个域名' <<<'$out'"
env_base; echo "APPS_URL=https://apps.localhost/x" >> "$I/yh.env"
out="$(yh start)"; rc=$?
t "APPS_URL 带路径：拒绝启动" sh -c "[ $rc != 0 ] && grep -q 'APPS_URL 格式不对' <<<'$out'"
env_base
out="$(yh start)"
t "去掉 APPS_URL：应用域名的配置删掉，隧道回到只有控制台域名" sh -c "[ ! -e $SITE/apps.site ] && [ ! -e $SITE/_apps-redirect.caddy ] && head -15 $F | cmp -s - $T/legacy.toml"

title "yh doctor"
env_base "t1.localhost=host.docker.internal:3005,t2.localhost=192.168.1.20:8080,oops"; touch "$SHIM/frpc-running"
yh start >/dev/null
cat > "$SHIM/frpc.log" <<'LOG'
2026-10-02 11:16:45.624 [I] [client/control.go:168] [1c2] [yh-platform] start proxy success
2026-10-02 11:16:45.624 [I] [client/control.go:168] [1c2] [yh-extra-t1-localhost] start proxy success
2026-10-02 11:16:45.624 [I] [client/control.go:168] [1c2] [yh-extra-t2-localhost] start proxy success
2026-10-02 11:20:45.624 [W] [client/control.go:166] [1c2] [yh-extra-t2-localhost] start error: router config conflict
LOG
echo "host.docker.internal:3005" > "$SHIM/reachable"
out="$(yh doctor)"
t "平台隧道检查不受影响" said '✓ 隧道已连上云端'
t "配置有错：报 ✗" said '✗ EXTRA_TUNNELS 配置'
t "t1 已登记 ✓" said '✓ 额外隧道 t1.localhost：已在云端登记'
t "t1 内网服务连得上 ✓" said '✓ 额外隧道 t1.localhost：内网服务 host.docker.internal:3005 连得上'
t "t1 公网访问 ✓（端口跟平台地址一致）" said "✓ 额外隧道 t1.localhost：公网访问 http://t1.localhost:$PORT"
t "t2 最后一次是登记失败：报 ✗ 并给出排查命令" said '✗ 额外隧道 t2.localhost：已在云端登记 .*grep yh-extra-t2-localhost'
t "t2 内网服务连不上：报 ✗ 并提示怎么确认" said '✗ 额外隧道 t2.localhost：内网服务 192.168.1.20:8080 连得上 .*curl http://127.0.0.1:8080'
env_base; out="$(yh doctor)"
nt "不配 EXTRA_TUNNELS：doctor 里没有额外隧道的检查" said '额外隧道'

printf '\n通过 %s，失败 %s\n' "$pass" "$fail"
if [ "$fail" = 0 ]; then rm -rf "$T"; else echo "现场保留在 $T"; fi
[ "$fail" = 0 ]
