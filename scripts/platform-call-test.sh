#!/bin/bash
# 平台调用补发自测：yh 的 platform_must / platform_queue / platform_flush（agent 交回操作结果、应用移除 / 停用通知控制台）
#   ./scripts/platform-call-test.sh     改了 yh 里这几个函数后必跑；不需要 Docker，用假的控制台
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(mktemp -d)"; trap 'rm -rf "$ROOT"' EXIT
for f in platform_send platform_must platform_queue platform_flush; do awk "/^$f\(\) \{/,/^}/" yh >> "$ROOT/fns.sh"; done
. "$ROOT/fns.sh"
sleep() { :; }
CALLS="$ROOT/calls"; : > "$CALLS"
# 假控制台：FAIL 文件里写还要失败几次；成功回 {"code":0}，失败回 500 的 JSON
platform_api() {
  local n; n="$(cat "$ROOT/FAIL" 2>/dev/null || echo 0)"
  echo "$1 $2 ${*:3}" >> "$CALLS"
  if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$ROOT/FAIL"; echo '{"code":9001,"message":"服务器错误"}'; else echo '{"code":0,"data":{"ok":true}}'; fi
}
ok=0; bad=0; t() { if eval "$2"; then ok=$((ok+1)); echo "  ✓ $1"; else bad=$((bad+1)); echo "  ✗ $1"; fi; }
echo "log body" > "$ROOT/op.log"

echo 3 > "$ROOT/FAIL"; platform_must "/api/platform/ops/7/finish?ok=true" "$ROOT/op.log"; rc=$?
t "失败 3 次后第 4 次送到" '[ $rc = 0 ] && [ "$(wc -l < "$CALLS" | tr -d " ")" = 4 ] && [ ! -d "$ROOT/backups/ops/unsent" ]'
t "带正文" 'grep -q "data-binary @$ROOT/op.log" "$CALLS"'

: > "$CALLS"; echo 99 > "$ROOT/FAIL"; platform_must "/api/platform/ops/8/finish?ok=true" "$ROOT/op.log"; rc=$?
platform_must "/api/platform/apps/demo/remove"; rc2=$?
t "一直失败：返回 1，两条都存下" '[ $rc = 1 ] && [ $rc2 = 1 ] && [ "$(ls "$ROOT/backups/ops/unsent"/*.path | wc -l | tr -d " ")" = 2 ]'
t "存下的正文是日志内容" '[ "$(cat "$ROOT"/backups/ops/unsent/*.body)" = "log body" ]'

: > "$CALLS"; echo 99 > "$ROOT/FAIL"; platform_flush
t "控制台还不行：补发停在第一条，都还在" '[ "$(wc -l < "$CALLS" | tr -d " ")" = 1 ] && [ "$(ls "$ROOT/backups/ops/unsent"/*.path | wc -l | tr -d " ")" = 2 ]'

: > "$CALLS"; echo 0 > "$ROOT/FAIL"; out="$(platform_flush)"
t "恢复后按顺序补发、清空" '[ "$(ls "$ROOT/backups/ops/unsent" | wc -l | tr -d " ")" = 0 ] && head -1 "$CALLS" | grep -q "ops/8/finish" && sed -n 2p "$CALLS" | grep -q "apps/demo/remove" && sed -n 2p "$CALLS" | grep -vq data-binary'
t "补发有记录" 'echo "$out" | grep -q "补发成功：/api/platform/ops/8/finish?ok=true"'
echo "结果：$ok 通过，$bad 失败"; [ $bad = 0 ]
