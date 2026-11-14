#!/bin/bash
# agent 版本判断 + 自动发布日志去重自测：yh 的 platform_version / cmd_agent 的版本比对 / cmd_watch 的「有新提交」日志
#   ./scripts/version-test.sh     改了 yh 里这几处后必跑；不需要 Docker，不起 agent，用本地 git 仓库当远端
set -u
cd "$(dirname "$0")/.." || exit 1
YH="$PWD/yh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ok=0; bad=0; t() { if eval "$2"; then ok=$((ok+1)); echo "  ✓ $1"; else bad=$((bad+1)); echo "  ✗ $1"; fi; }
VERFNS="$(sed -n '/^platform_version_file()/,/^platform_version()/p' "$YH")"
pv() { ( ROOT="$T"; eval "$VERFNS"; platform_version ) 2>&1; }

echo "platform_version"
echo 1.2.3 > "$T/VERSION"
t "正常读到版本" '[ "$(pv)" = 1.2.3 ]'
rm -f "$T/VERSION"
t "缺 VERSION：不输出 0.0.0，也没有报错输出" '[ "$(pv)" = "" ]'
: > "$T/VERSION"
t "空 VERSION：输出空" '[ "$(pv)" = "" ]'
echo 0.0.0 > "$T/VERSION"
t "VERSION 是 0.0.0：当作读不到" '[ "$(pv)" = "" ]'
echo 1.2.3 > "$T/VERSION"
got="$( ( ROOT="$T"; eval "$VERFNS"; rm -f "$T/VERSION"; echo "$(platform_version_file)|$(platform_version)" ) 2>&1 )"
t "进程中途读不到：沿用上一次已知版本" '[ "$got" = "|1.2.3" ]'

echo "cmd_agent 版本比对"
# 抽出主循环里的版本判断，exec 换成打印
STEP="$(sed -n '/# 读不到 VERSION 时跳过比对/,/^    fi$/p' "$YH" | sed 's|exec /bin/bash .*|echo RESTART; return|')"
[ -n "$STEP" ] || { echo "  ✗ yh 里找不到 agent 的版本判断"; exit 1; }
run_agent() { # 每个参数是一轮开始前 VERSION 的内容（- 表示没有这个文件）
  ( ROOT="$T"; eval "$VERFNS"; deploy_locked() { return 1; }; eval "step() { $STEP
  }"
    echo 1.2.3 > "$T/VERSION"; ver="$(platform_version_file)"; ver_missing=""; local v
    for v in "$@"; do if [ "$v" = - ]; then rm -f "$T/VERSION"; else echo "$v" > "$T/VERSION"; fi; step; done ) 2>&1
}
out="$(run_agent - - - - 1.2.3 1.2.3)"
t "缺 VERSION 4 轮再恢复：不重启" '! echo "$out" | grep -q RESTART'
t "警告只打一行" '[ "$(echo "$out" | grep -c "警告：读不到 VERSION，跳过版本比对")" = 1 ]'
t "恢复时打一行" '[ "$(echo "$out" | grep -c "VERSION 已恢复（1.2.3）")" = 1 ]'
t "没有别的输出" '[ "$(echo "$out" | wc -l | tr -d " ")" = 2 ]'
out="$(run_agent 0.0.0 "")"
t "0.0.0 / 空内容：不重启" '! echo "$out" | grep -q RESTART'
out="$(run_agent 1.2.3 - 1.2.4)"
t "真升级了（中间缺过一次）：重启" 'echo "$out" | grep -q "平台已从 1.2.3 更新到 1.2.4" && echo "$out" | grep -q RESTART'

echo "cmd_watch 日志"
APPS="$T/apps"; mkdir -p "$APPS/m1" "$APPS/a1"
git init -q --bare -b release "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
( cd "$T/work" && git checkout -q -b release && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m 1 && git push -q origin release )
for a in m1 a1; do git clone -q -b release "$T/origin.git" "$APPS/$a/src"; echo "git:x" > "$APPS/$a/.source"; done
( cd "$T/work" && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m 2 && git push -q origin release )
NEW="$(git -C "$T/work" rev-parse HEAD)"
WATCH="$(awk '/^cmd_watch\(\) \{/,/^}/' "$YH")"
run_watch() {
  ( eval "$WATCH"; ROOT="$T"; APPS="$APPS"
    load_env() { :; }; self_update() { :; }; deploy_lock() { return 0; }; deploy_unlock() { :; }
    manifest() { echo "$1"; }
    mf() { case "$2" in .deploy.mode) [ "$1" = m1 ] && echo manual || echo auto;; .deploy.branch) echo release;; .name) echo "$1";; esac; }
    notify() { echo "NOTIFY $1"; }
    deploy_git() { echo "DEPLOY $1"; echo "$NEW" > "$APPS/$1/.deploy-failed"; } # 假装部署失败
    cmd_watch --no-self ) 2>&1
}
o1="$(run_watch)"; o2="$(run_watch)"; o3="$(run_watch)"
t "手动发布：第一轮打日志 + 通知" 'echo "$o1" | grep -q "m1：release 有新提交" && echo "$o1" | grep -q "NOTIFY 🆕 m1"'
t "自动发布：第一轮打日志 + 部署" 'echo "$o1" | grep -q "a1：release 有新提交" && echo "$o1" | grep -q "DEPLOY a1"'
t "之后几轮：同一提交完全静默" '[ -z "$o2" ] && [ -z "$o3" ]'
( cd "$T/work" && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m 3 && git push -q origin release )
NEW="$(git -C "$T/work" rev-parse HEAD)"
o4="$(run_watch)"
t "再来新提交：两个应用各打一行" '[ "$(echo "$o4" | grep -c "有新提交 ${NEW:0:7}")" = 2 ]'

echo
echo "通过 ${ok}，失败 ${bad}"
[ "$bad" = 0 ]
