#!/bin/bash
# 改平台版本号：./scripts/bump-version.sh <x.y.z>
#
# 版本号遵循语义化版本（docs/版本管理.md）：0.x 是 Beta；加功能升次版本号（0.1.0 → 0.2.0），只修问题升修订号（0.2.0 → 0.2.1）。
# 一处改全：根目录 VERSION（yh、更新包用）、控制台前后端的 package.json / package-lock.json（界面上显示的版本），
# 并在「版本更新说明」（console/docs/devcenter/releases.md，线上 /dev/releases）顶上加一节待填。
# 单元测试会校验这几处一致（console/backend/test/version.test.js）。改完填好更新说明、提交，再按部署手册「平台升级」打包。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

die() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

NEW="${1:-}"
echo "$NEW" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || die "用法：$0 <x.y.z>，如 $0 0.2.0"
CUR="$(tr -d '[:space:]' < VERSION 2>/dev/null)"
[ "$NEW" = "$CUR" ] && die "当前已经是 $CUR"
# 只能往上升（按数字比较每一段）
newer() {
  local IFS=.; local a=($1) b=($2) i
  for i in 0 1 2; do
    [ "${a[$i]}" -gt "${b[$i]}" ] && return 0
    [ "${a[$i]}" -lt "${b[$i]}" ] && return 1
  done
  return 1
}
[ -n "$CUR" ] && ! newer "$NEW" "$CUR" && die "新版本 $NEW 要比当前 $CUR 高"
command -v node >/dev/null || die "需要 node（改 package.json 用）"

printf '%s\n' "$NEW" > VERSION
for f in console/backend/package.json console/frontend/package.json console/backend/package-lock.json console/frontend/package-lock.json; do
  [ -f "$f" ] || continue
  node -e '
    const fs = require("fs"); const [f, v] = process.argv.slice(1)
    const j = JSON.parse(fs.readFileSync(f, "utf8"))
    j.version = v
    if (j.packages && j.packages[""]) j.packages[""].version = v
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n")
  ' "$f" "$NEW" || die "改 $f 失败"
done

NOTES=console/docs/devcenter/releases.md
if [ -f "$NOTES" ] && ! grep -q "^## v$NEW" "$NOTES"; then
  TODAY="$(date +%Y-%m-%d)"
  node -e '
    const fs = require("fs"); const [f, v, d] = process.argv.slice(1)
    let s = fs.readFileSync(f, "utf8")
    const i = s.indexOf("\n## v")
    const block = `\n## v${v} · ${d}\n\n- （在这里写这个版本的更新说明：新功能、改动、修复、升级注意事项）\n`
    s = i < 0 ? s.trimEnd() + "\n" + block : s.slice(0, i) + "\n" + block.trimStart() + s.slice(i)
    s = s.replace(/^updated: .*$/m, `updated: ${d}`)
    fs.writeFileSync(f, s)
  ' "$NOTES" "$NEW" "$TODAY"
fi

printf '\033[32m✓ 版本 %s → %s\033[0m\n' "${CUR:-无}" "$NEW"
echo "  下一步：填好 $NOTES 里 v$NEW 的更新说明 → cd console/backend && npm test → 提交 → ./scripts/pack.sh"
