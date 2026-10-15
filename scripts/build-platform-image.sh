#!/bin/bash
# 打平台镜像（Docker 安装用，docker/Dockerfile）：把当前提交导出来（和更新包里的文件一样），连同 yh 的依赖做成镜像
#
#   ./scripts/build-platform-image.sh                 本机构建当前架构，镜像 yihu-one:<版本>（试 Docker 安装用）
#   ./scripts/build-platform-image.sh --worktree      同上，但带上工作区里没提交的改动（只用于开发自测，不能拿去发）
#   ./scripts/build-platform-image.sh --push <仓库>   多架构（amd64 + arm64）构建并推送 <仓库>:<版本> 和 :latest（发版 CI 用，
#                                                     .github/workflows/console-image.yml；仓库如 ghcr.io/guoylyy/yihu-one）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

die() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
step() { printf '\033[36m▶ %s\033[0m\n' "$*"; }

WORKTREE=""; PUSH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree) WORKTREE="1"; shift;;
    --push) PUSH="${2:-}"; [ -n "$PUSH" ] || die "--push 要跟镜像仓库，如 ghcr.io/guoylyy/yihu-one"; shift 2;;
    *) die "未知参数 $1";;
  esac
done
git rev-parse --git-dir >/dev/null 2>&1 || die "要在 Git 仓库里构建"
[ -z "$PUSH" ] || [ -z "$WORKTREE" ] || die "--worktree 只能本机构建，不能推送"
VERSION="$(tr -d '[:space:]' < VERSION)"

STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
step "导出平台文件（$([ -n "$WORKTREE" ] && echo '工作区，含没提交的改动' || echo "提交 $(git rev-parse --short=7 HEAD)")）"
if [ -n "$WORKTREE" ]; then
  # 已跟踪 + 没被忽略的新文件，去掉 export-ignore 的（和 git archive 一样）
  git ls-files -z --cached --others --exclude-standard | xargs -0 git check-attr -z export-ignore \
    | while IFS= read -r -d '' f && IFS= read -r -d '' _ && IFS= read -r -d '' v; do [ "$v" = set ] || [ ! -f "$f" ] || echo "$f"; done \
    | tar -cf - -T - | tar -xf - -C "$STAGE" || die "导出失败"
else
  git archive --worktree-attributes HEAD | tar -x -C "$STAGE" || die "导出失败"
fi
# 文件清单：yh upgrade 据此删掉新版本里已经没有的文件（同 scripts/pack.sh）
(cd "$STAGE" && : > .yh-files && find . -type f | sed 's#^\./##' | LC_ALL=C sort > ../files.$$ && mv ../files.$$ .yh-files)

if [ -n "$PUSH" ]; then
  step "构建并推送 $PUSH:$VERSION（amd64 + arm64）"
  docker buildx build --platform linux/amd64,linux/arm64 -f "$STAGE/docker/Dockerfile" --build-arg VERSION="$VERSION" \
    -t "$PUSH:$VERSION" -t "$PUSH:latest" --push "$STAGE" || die "构建失败"
else
  step "构建 yihu-one:$VERSION"
  docker build -f "$STAGE/docker/Dockerfile" --build-arg VERSION="$VERSION" -t "yihu-one:$VERSION" "$STAGE" || die "构建失败"
  echo
  echo "✅ 镜像 yihu-one:$VERSION。试装（本机没有别的平台时）："
  echo "   docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock -v \$HOME/yihu-one-docker:\$HOME/yihu-one-docker yihu-one:$VERSION --test --demo"
fi
