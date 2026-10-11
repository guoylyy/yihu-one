#!/bin/bash
# 公网入口巡检（云服务器侧）：cron 每 5 分钟跑一次，从这台服务器访问平台入口，连续 2 次不通就往群机器人发通知，恢复了再发一次。
# 平台机器关机、断网、隧道断了时，平台自己的 agent 发不出通知——靠这里。由 install.sh 带 ALERT_WEBHOOK 时安装。
#
#   ./healthcheck.sh          巡检一次（cron 调用）
#   ./healthcheck.sh --test   发一条测试通知，确认机器人配对了
#
# 配置在同目录的 health.env（install.sh 生成，权限 600）：
#   DOMAIN=one.example.com  APPS_DOMAIN=apps.one.example.com（可选）
#   ALERT_WEBHOOK=<飞书 / 钉钉 / 企业微信群机器人地址>  ALERT_DINGTALK_SECRET=<钉钉加签密钥（可选）>
set -u
cd "$(dirname "$0")"
[ -f health.env ] && . ./health.env
: "${DOMAIN:?health.env 里没有 DOMAIN}"
: "${ALERT_WEBHOOK:?health.env 里没有 ALERT_WEBHOOK}"
SCHEME="${HEALTH_SCHEME:-https}"               # 测试时用 http
STATE_DIR="${HEALTH_STATE_DIR:-/var/lib/yh-one-health}"
mkdir -p "$STATE_DIR"

json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//'; }

send() { # send <纯文本>。按地址认机器人；钉钉的「自定义关键词」安全设置可以填「以虎 One」
  local text="$1 · 以虎 One 平台巡检" url="$ALERT_WEBHOOK" body ts sign
  case "$url" in
    *open.feishu.cn*|*open.larksuite.com*) body="{\"msg_type\":\"text\",\"content\":{\"text\":\"$(json_str "$text")\"}}";;
    *qyapi.weixin.qq.com*) body="{\"msgtype\":\"text\",\"text\":{\"content\":\"$(json_str "$text")\"}}";;
    *)
      body="{\"msgtype\":\"text\",\"text\":{\"content\":\"$(json_str "$text")\"}}"
      if [ -n "${ALERT_DINGTALK_SECRET:-}" ]; then
        ts="$(($(date +%s) * 1000))"
        sign="$(printf '%s\n%s' "$ts" "$ALERT_DINGTALK_SECRET" | openssl dgst -sha256 -hmac "$ALERT_DINGTALK_SECRET" -binary | base64 | tr -d '\n' | sed 's/+/%2B/g; s/\//%2F/g; s/=/%3D/g')"
        url="$url&timestamp=$ts&sign=$sign"
      fi;;
  esac
  curl -s --max-time 10 -H 'Content-Type: application/json' -d "$body" "$url" >/dev/null || true
}

if [ "${1:-}" = "--test" ]; then
  send "✅ 巡检已开启：每 5 分钟检查 ${SCHEME}://${DOMAIN}${APPS_DOMAIN:+ 和 ${SCHEME}://${APPS_DOMAIN}}，打不开时会在这里通知"
  echo "已发送测试通知"; exit 0
fi

check() { # check <状态文件名（英文）> <名称> <地址> <期望：200 或 apps>
  local f="$STATE_DIR/$1" name="$2" url="$3" want="$4" st="" fails="" since="" now ok=""
  now="$(date +%s)"
  if [ -f "$f" ]; then read -r st fails since < "$f"; fi
  st="${st:-ok}"; fails="${fails:-0}"; since="${since:-$now}"
  if [ "$want" = apps ]; then curl -s -o /dev/null -D - --max-time 15 "$url" 2>/dev/null | grep -qi '^x-yh-apps:' && ok=1
  else [ "$(curl -s -o /dev/null --max-time 15 -w '%{http_code}' "$url" 2>/dev/null)" = 200 ] && ok=1; fi
  if [ -n "$ok" ]; then
    [ "$st" = down ] && send "✅ ${name}恢复了：${url}（中断了约 $(( (now - since + 59) / 60 )) 分钟）"
    st=ok; fails=0; since="$now"
  else
    fails=$((fails + 1))
    if [ "$st" != down ] && [ "$fails" -ge 2 ]; then
      send "🔴 ${name}打不开：${url}（已连续 ${fails} 次，每 5 分钟查一次）。先看平台机器是否开机、联网，再在平台机器上执行 yh doctor"
      st=down; since="$now"
    fi
  fi
  echo "$st $fails $since" > "$f"
}

check platform "平台入口" "${SCHEME}://${DOMAIN}/health" 200
if [ -n "${APPS_DOMAIN:-}" ]; then check apps "应用域名" "${SCHEME}://${APPS_DOMAIN}/" apps; fi
exit 0
