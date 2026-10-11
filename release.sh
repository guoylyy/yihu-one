#!/bin/bash
# 发布：跑测试 → 把 main 推到 release 分支。平台上的 yh agent 两分钟内自动更新，失败自动回滚，结果发到通知群、并记在控制台。
#   ./release.sh
# 规则：只在 main 上开发，release 只由本脚本更新（不要直接往 release 提交）。
set -uo pipefail
TEST_CMD='bash -n yh && (cd console/backend && npm test) && ./scripts/selftest.sh'

cd "$(dirname "$0")" || exit 1
die() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "请切到 main 分支再发布"
[ -z "$(git status --porcelain)" ] || die "有未提交的改动，先提交或暂存"
git fetch -q origin || die "git fetch 失败"
git merge-base --is-ancestor origin/main HEAD || die "远端 main 有你本地没有的提交，先 git pull --rebase"
if git rev-parse -q --verify origin/release >/dev/null; then
  git merge-base --is-ancestor origin/release HEAD || die "release 上有 main 没有的提交（有人直接改了 release？），先合回 main"
  [ "$(git rev-parse origin/release)" != "$(git rev-parse HEAD)" ] || die "没有新提交，release 已是最新"
  echo "本次发布："; git log --oneline --no-merges origin/release..HEAD | sed 's/^/  /'
else
  echo "首次创建 release 分支：$(git log -1 --oneline)"
fi

printf '\033[36m▶ 测试：%s\033[0m\n' "$TEST_CMD"
bash -c "$TEST_CMD" || die "测试未通过，停止发布"

git push -q origin HEAD:main && git push -q origin HEAD:release || die "推送失败"
printf '\033[32m✅ 已发布 %s，2 分钟内自动上线，结果看通知群或控制台「管理 → 应用」（服务器上 yh history）\033[0m\n' "$(git rev-parse --short=7 HEAD)"
