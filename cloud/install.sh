#!/bin/bash
# 云服务器一次性安装：frps 隧道服务端 + 在已有的 Caddy 里加一段平台域名的 HTTPS 反代
# 在云服务器上执行：DOMAIN=one.example.com FRP_TOKEN=<与平台 yh.env 里一致> ./install.sh
#   平台配了应用独立域名（yh.env 的 APPS_URL）时再加 APPS_DOMAIN=apps.one.example.com，两个域名都走同一条隧道
#   加 ALERT_WEBHOOK=<飞书 / 钉钉 / 企业微信群机器人地址>（钉钉加签再加 ALERT_DINGTALK_SECRET）：装上公网巡检，平台打不开时往群里报警
#   新服务器（Ubuntu / Debian）加 INSTALL_DEPS=1：没装 Docker、Caddy 的自动装上（国内服务器再加 CN=1 走国内源和镜像）
# 前提：域名已解析到这台服务器；安全组放行 TCP 7000（隧道）、80、443。没加 INSTALL_DEPS 时要已装好 Docker 和 Caddy（systemd 管理，配置 /etc/caddy/Caddyfile）
# 幂等：重复执行只更新配置；改 Caddyfile 前自动备份，校验不通过不会 reload，不影响同机其他站点
# 一台云服务器服务一家公司（frps 端口 7000 / 7080、容器名 yh-frps 是固定的）；多家公司共用一台要另起 frps，见部署手册
set -euo pipefail
cd "$(dirname "$0")"

[ "$(id -u)" = "0" ] || { echo "要用 root 执行：sudo DOMAIN=… FRP_TOKEN=… ./install.sh"; exit 1; }
if [ "${CN:-}" = "1" ]; then export IMAGE_MIRROR="${IMAGE_MIRROR:-docker.m.daocloud.io/}"; fi

if [ "${INSTALL_DEPS:-}" = "1" ]; then
  echo "▶ 0/3 依赖（Docker、Caddy）"
  command -v apt-get >/dev/null 2>&1 || { echo "  INSTALL_DEPS 只支持 Ubuntu / Debian（apt），其他系统请先手动装 Docker 和 Caddy"; exit 1; }
  if ! command -v docker >/dev/null 2>&1; then
    if [ "${CN:-}" = "1" ]; then curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun; else curl -fsSL https://get.docker.com | sh; fi
    systemctl enable --now docker
  fi
  docker compose version >/dev/null 2>&1 || apt-get install -y docker-compose-plugin
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
    # 刚装的 Caddy 自带一个 :80 的示例站点，会抢走 80 端口上所有域名（证书签发和跳转 HTTPS 都会受影响），换成空配置
    if grep -qE '^:80' /etc/caddy/Caddyfile 2>/dev/null; then cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.dist; echo "# 由以虎 One cloud/install.sh 初始化" > /etc/caddy/Caddyfile; fi
    systemctl enable --now caddy
  fi
  echo "  Docker $(docker --version | awk '{print $3}' | tr -d ,)、Caddy $(caddy version | awk '{print $1}')"
fi
command -v docker >/dev/null 2>&1 || { echo "没装 Docker：加 INSTALL_DEPS=1 自动装，或手动装好再执行"; exit 1; }
command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ] || { echo "没装 Caddy（或没有 /etc/caddy/Caddyfile）：加 INSTALL_DEPS=1 自动装"; exit 1; }

CADDYFILE=/etc/caddy/Caddyfile
: "${DOMAIN:?请设置 DOMAIN（平台访问地址的域名，如 one.example.com）}"
: "${FRP_TOKEN:?请设置 FRP_TOKEN（与平台 yh.env 里的一致）}"
APPS_DOMAIN="${APPS_DOMAIN:-}"
if [ -n "$APPS_DOMAIN" ] && [ "$APPS_DOMAIN" = "$DOMAIN" ]; then echo "APPS_DOMAIN 不能和 DOMAIN 相同"; exit 1; fi

echo "▶ 1/3 frps"
cat > frps.toml <<TOML
bindPort = 7000
vhostHTTPPort = 7080
auth.method = "token"
auth.token = "${FRP_TOKEN}"
log.to = "console"
log.level = "info"
TOML
chmod 600 frps.toml
docker compose up -d
sleep 2
docker ps --filter name=yh-frps --format '  {{.Names}} {{.Status}}'

echo "▶ 2/3 Caddy"
BAK="${CADDYFILE}.bak-yhone-$(date +%Y%m%d%H%M%S)"
cp "$CADDYFILE" "$BAK"
echo "  已备份到 $BAK"
TMP=$(mktemp)
# 去掉旧的平台段，再追加新的
sed '/# ===== 以虎 One 平台：/,/# ===== 以虎 One 平台 END =====/d' "$CADDYFILE" > "$TMP"
cat >> "$TMP" <<CADDY

# ===== 以虎 One 平台：${DOMAIN}${APPS_DOMAIN:+ 和应用域名 $APPS_DOMAIN} 经 frp 隧道转到内网的平台机器 =====
${DOMAIN}${APPS_DOMAIN:+, $APPS_DOMAIN} {
	reverse_proxy 127.0.0.1:7080 {
		# AI 助手是流式输出
		flush_interval -1
		# 隧道断开（平台机器关机、断网）时给出能看懂的提示
		@down status 502 503 504
		handle_response @down {
			header Content-Type "text/html; charset=utf-8"
			respond "<p style='font:15px sans-serif;padding:24px'>平台暂时连不上，请稍后再试或联系管理员。</p>" 502
		}
	}
}
# ===== 以虎 One 平台 END =====
CADDY
if caddy validate --config "$TMP" --adapter caddyfile >/dev/null 2>&1; then
  cp "$TMP" "$CADDYFILE"
  systemctl reload caddy
  echo "  校验通过，已 reload"
else
  echo "  ❌ 新配置校验失败，未改动线上配置。详情："
  caddy validate --config "$TMP" --adapter caddyfile || true
  exit 1
fi
rm -f "$TMP"

if [ -n "${ALERT_WEBHOOK:-}" ]; then
  echo "▶ 公网巡检（平台机器关机 / 断网时，靠这里报警）"
  umask 077
  cat > health.env <<ENV
DOMAIN=${DOMAIN}
APPS_DOMAIN=${APPS_DOMAIN}
ALERT_WEBHOOK=${ALERT_WEBHOOK}
ALERT_DINGTALK_SECRET=${ALERT_DINGTALK_SECRET:-}
ENV
  umask 022
  chmod +x healthcheck.sh
  echo "*/5 * * * * root $(pwd)/healthcheck.sh >/dev/null 2>&1" > /etc/cron.d/yh-one-health
  chmod 644 /etc/cron.d/yh-one-health
  ./healthcheck.sh --test && echo "  已装好（/etc/cron.d/yh-one-health），群里应收到一条测试通知"
fi

echo "▶ 3/3 自检"
echo "  平台机器 yh start 后，访问 https://${DOMAIN} 应看到控制台登录页"
if [ -n "$APPS_DOMAIN" ]; then echo "  应用域名：https://${APPS_DOMAIN}/apps/<应用code>/（证书由 Caddy 自动签发，域名要先解析到这台服务器）"; fi
# 域名有没有解析到这台机器（没解析好证书签不下来）
myip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
for h in "$DOMAIN" ${APPS_DOMAIN:+"$APPS_DOMAIN"}; do
  ip="$(getent hosts "$h" 2>/dev/null | awk '{print $1; exit}')"
  if [ -z "$ip" ]; then echo "  ⚠️ $h 还没解析：解析到 ${myip:-这台服务器的公网 IP} 后 Caddy 会自动签证书"
  elif [ -n "$myip" ] && [ "$ip" != "$myip" ]; then echo "  ⚠️ $h 解析到 ${ip}，这台服务器是 $myip"
  else echo "  ✓ $h → $ip"; fi
done
echo "✅ 云端就绪。别忘了：安全组放行 TCP 7000（隧道）和 80/443（HTTPS 证书与访问）"
