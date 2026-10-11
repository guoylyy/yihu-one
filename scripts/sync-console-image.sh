#!/bin/bash
# 服务器端：每 5 分钟（cron）检查镜像仓库是否有新控制台镜像
# 有新版本 → 拉取 → 重启 console → 健康检查 → 不通过自动回滚 → 钉钉通知
# 由 /etc/cron.d/yh-sync-console 调度；日志：backups/sync-image.log
set -uo pipefail
ROOT="/root/yihu-one"
cd "$ROOT" || exit 0

[ -f yh.env ] && set -a && source yh.env && set +a
: "${ACR_REGISTRY:?yh.env 缺少 ACR_REGISTRY}"
: "${ACR_NAMESPACE:?yh.env 缺少 ACR_NAMESPACE}"

IMG="$ACR_REGISTRY/$ACR_NAMESPACE/yh-console"
STATE="$ROOT/backups/.synced-digest"
TS="$(date '+%F %T')"

# 钉钉通知（与 yh 的 notify 同一套加签逻辑；测试模式不发）
notify() {
  local title="$1" text="$2"
  [ -n "${DINGTALK_WEBHOOK:-}" ] || return 0
  [ "${PLATFORM_MODE:-}" = "test" ] && return 0
  local url="$DINGTALK_WEBHOOK" ts sign body resp
  if [ -n "${DINGTALK_SECRET:-}" ]; then
    ts="$(($(date +%s) * 1000))"
    sign="$(printf '%s\n%s' "$ts" "$DINGTALK_SECRET" | openssl dgst -sha256 -hmac "$DINGTALK_SECRET" -binary | base64 | tr -d '\n' | jq -sRr @uri)"
    url="$url&timestamp=$ts&sign=$sign"
  fi
  body="$(jq -n --arg t "$title" --arg x "$text" '{msgtype:"markdown", markdown:{title:$t, text:$x}}')"
  resp="$(curl -s --max-time 10 -H 'Content-Type: application/json' -d "$body" "$url")"
  [ "$(echo "$resp" | jq -r .errcode 2>/dev/null)" = "0" ] || echo "[$TS] 通知发送失败：$resp"
}

# 1) 查远端 digest（先 manifest inspect，失败退回 imagetools）
REMOTE="$(docker manifest inspect "$IMG:latest" 2>/dev/null | jq -r '.Manifests[0].digest // .Descriptor.digest // empty' 2>/dev/null)"
if [ -z "$REMOTE" ]; then
  REMOTE="$(docker buildx imagetools inspect "$IMG:latest" --format '{{.Manifest.Digest}}' 2>/dev/null || true)"
fi
[ -n "$REMOTE" ] || { echo "[$TS] 查询远端镜像失败（docker login 或网络问题）"; exit 0; }

# 2) 已同步过则退出
[ -f "$STATE" ] && [ "$(cat "$STATE" 2>/dev/null)" = "$REMOTE" ] && exit 0

# 3) 记录当前镜像（回滚点），拉取并替换
OLD_ID="$(docker image inspect yh-console:latest --format '{{.Id}}' 2>/dev/null || true)"
echo "[$TS] 发现新镜像 ${REMOTE:0:30}…（当前：${OLD_ID##sha256:}），同步中"
docker pull -q "$IMG:latest" || { echo "[$TS] ❌ 拉取失败"; exit 0; }
docker tag "$IMG:latest" yh-console:latest

# 4) 重启 + 健康检查（最长 90 秒）
OK=0
if docker compose -f platform/compose.yml up -d console >/dev/null 2>&1; then
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${LOCAL_HTTP_PORT:-18080}/api/platform/ping" 2>/dev/null | grep -q '"ok":true'; then OK=1; break; fi
    sleep 3
  done
fi

# 5) 结果处理
if [ "$OK" = 1 ]; then
  echo "$REMOTE" > "$STATE"
  echo "[$TS] ✅ 控制台已更新，健康检查通过"
  notify "✅ yihu-one 控制台已自动更新" "#### ✅ 控制台镜像已同步上线\n\n- 版本：${REMOTE:0:30}\n- 来源：$IMG:latest"
else
  echo "[$TS] ❌ 健康检查未通过，回滚旧镜像"
  if [ -n "$OLD_ID" ]; then
    docker tag "$OLD_ID" yh-console:latest
    docker compose -f platform/compose.yml up -d console >/dev/null 2>&1
    sleep 10
    curl -fsS "http://127.0.0.1:${LOCAL_HTTP_PORT:-18080}/api/platform/ping" 2>/dev/null | grep -q '"ok":true' \
      && echo "[$TS] 已回滚，旧版本恢复正常" || echo "[$TS] ⚠️ 回滚后仍异常，需人工介入：yh logs console"
  fi
  notify "❌ yihu-one 控制台更新失败（已回滚）" "#### ❌ 镜像 $IMG:latest 健康检查未通过\n\n- 已回滚旧版本，详见服务器 backups/sync-image.log\n- 人工检查：ssh 后 \`yh logs console\`"
fi
