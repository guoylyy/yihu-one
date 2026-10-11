#!/bin/bash
# 控制台镜像发版（路线A）：构建 linux/amd64 → 推送镜像仓库（阿里云 ACR）
# 服务器上的 scripts/sync-console-image.sh 会每 5 分钟自动发现新镜像并上线（带健康检查+回滚）
# 用法：./scripts/push-console-image.sh          （配置读 yh.env 的 ACR_REGISTRY / ACR_NAMESPACE）
set -euo pipefail
cd "$(dirname "$0")/.."

# 读取 yh.env（只取 ACR_* 与通用变量，不覆盖已有环境变量）
if [ -f yh.env ]; then
  while IFS='=' read -r k v; do
    case "$k" in ACR_*|DINGTALK_*) [ -n "${k// }" ] && export "$k=${v#\"}" 2>/dev/null || true;; esac
  done < <(grep -E '^[A-Z_]+=' yh.env)
fi

: "${ACR_REGISTRY:?缺少 ACR_REGISTRY（如 registry.cn-shanghai.aliyuncs.com），配到 yh.env}"
: "${ACR_NAMESPACE:?缺少 ACR_NAMESPACE（ACR 命名空间），配到 yh.env}"

IMG="$ACR_REGISTRY/$ACR_NAMESPACE/yh-console"
VER="$(git rev-parse --short=7 HEAD)"

echo "▶ 构建并推送 $IMG:$VER (+ :latest)"
docker buildx build --platform linux/amd64 \
  -f console/Dockerfile \
  -t "$IMG:$VER" -t "$IMG:latest" \
  --label "org.opencontainers.image.revision=$VER" \
  console/ --push

echo ""
echo "✅ 已推送 $IMG:$VER"
echo "   服务器 5 分钟内自动同步上线（cron sync-console-image），结果看钉钉群或服务器 backups/sync-image.log"
