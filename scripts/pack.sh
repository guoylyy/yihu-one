#!/bin/bash
# 打平台更新包（发布方用）：把当前提交打成 yihu-one-<版本>.tar.gz，并生成更新清单 latest.json
#
#   ./scripts/pack.sh [--notes "更新说明"] [--min <最低可升级版本>] [--base-url <更新包所在目录的地址>]
#
# 发布一个版本：
#   1) ./scripts/bump-version.sh <x.y.z>（改 VERSION 和控制台的版本号），填好版本更新说明，提交
#   2) ./scripts/pack.sh           → dist/yihu-one-<版本>.tar.gz、dist/latest.json（配了签名私钥还有 .sig）
#   3) 把这几个文件传到下载地址的同一个目录下（latest.json 的地址就是客户 yh.env 里的 UPGRADE_URL）
#   4) git tag v<版本> && git push origin v<版本>（下次打包的更新说明从这个标签之后的提交里取）
# 客户那边：联网的在控制台点「升级」或 yh upgrade；不联网的把 tar.gz（和 .sig）拷过去 yh upgrade --package，或在控制台上传。
# 同一个包也能全新安装：install.sh --src <包的地址>
#
# 包里只有 Git 里已提交的文件（.gitattributes 里标了 export-ignore 的除外），所以要先提交再打包。
# 签名（可选）：环境变量 YH_RELEASE_KEY 指向 RSA 私钥时给包签名；对应的公钥提交在 platform/release.pub，
#   装了带公钥版本的机器只接受签名对得上的更新包。生成密钥：
#   openssl genrsa -out ~/.yihu-one-release.key 3072 && openssl rsa -in ~/.yihu-one-release.key -pubout -out platform/release.pub
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

die() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
step() { printf '\033[36m▶ %s\033[0m\n' "$*"; }

NOTES=""; MIN="0.0.0"; BASE_URL="${YH_RELEASE_BASE_URL:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --notes) NOTES="${2:-}"; shift 2;;
    --min) MIN="${2:-}"; shift 2;;
    --base-url) BASE_URL="${2:-}"; shift 2;;
    *) die "未知参数 $1";;
  esac
done

command -v jq >/dev/null 2>&1 || die "缺少 jq"
git rev-parse --git-dir >/dev/null 2>&1 || die "要在 Git 仓库里打包"
[ -z "$(git status --porcelain)" ] || die "有未提交的改动：包里只有已提交的文件，先提交再打包"

VERSION="$(tr -d '[:space:]' < VERSION 2>/dev/null)"
echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || die "VERSION 须为 x.y.z，当前：${VERSION:-（没有 VERSION 文件）}"
echo "$MIN" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || die "--min 须为 x.y.z"
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && [ "$(git rev-parse "v$VERSION^{commit}")" != "$(git rev-parse HEAD)" ] \
  && die "标签 v$VERSION 已经打在别的提交上了：这个版本发过了，先改 VERSION"

step "基础校验：yh 语法 + 后端单测（发布前另跑 ./scripts/selftest.sh）"
/bin/bash -n yh || die "yh 语法错误"
# scripts/upgrade-test.sh 在临时仓库里打测试包时跳过单测（那里没装依赖）
[ -n "${YH_PACK_SKIP_TESTS:-}" ] || (cd console/backend && npm test >/dev/null 2>&1) || die "后端单测未通过"

# 更新说明：没给就取上一个版本标签之后的提交标题
if [ -z "$NOTES" ]; then
  PREV="$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD 2>/dev/null || true)"
  [ "$PREV" = "v$VERSION" ] && PREV="$(git describe --tags --abbrev=0 --match 'v[0-9]*' "HEAD^" 2>/dev/null || true)"
  NOTES="$(git log --no-merges --format='- %s' ${PREV:+"$PREV..HEAD"} | head -20)"
fi

OUT="dist"; NAME="yihu-one-$VERSION"; TARBALL="$OUT/$NAME.tar.gz"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT" "$STAGE/$NAME"

step "打包 ${TARBALL}（提交 $(git rev-parse --short=7 HEAD)）"
git archive --worktree-attributes HEAD | tar -x -C "$STAGE/$NAME" || die "导出代码失败"
DATE="$(date +%Y-%m-%d)"
jq -n --arg v "$VERSION" --arg min "$MIN" --arg d "$DATE" --arg c "$(git rev-parse HEAD)" --arg n "$NOTES" \
  '{version:$v, minVersion:$min, date:$d, commit:$c, notes:$n}' > "$STAGE/$NAME/.yh-release"
# 文件清单：升级时据此删掉新版本里已经没有的文件
(cd "$STAGE/$NAME" && : > .yh-files && find . -type f | sed 's#^\./##' | LC_ALL=C sort > "$STAGE/files" && mv "$STAGE/files" .yh-files)
COPYFILE_DISABLE=1 tar -czf "$TARBALL" -C "$STAGE" "$NAME" || die "打包失败"

if command -v shasum >/dev/null 2>&1; then SHA="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
else SHA="$(sha256sum "$TARBALL" | awk '{print $1}')"; fi

SIG=""
if [ -n "${YH_RELEASE_KEY:-}" ]; then
  [ -f "$YH_RELEASE_KEY" ] || die "签名私钥不存在：$YH_RELEASE_KEY"
  [ -f platform/release.pub ] || die "有私钥但仓库里没有 platform/release.pub（公钥要提交进去，客户机器靠它验签）"
  SIG="$(openssl dgst -sha256 -sign "$YH_RELEASE_KEY" "$TARBALL" | openssl base64 -A)" || die "签名失败"
  [ -n "$SIG" ] || die "签名失败"
  openssl dgst -sha256 -verify platform/release.pub -signature <(echo "$SIG" | openssl base64 -d -A) "$TARBALL" >/dev/null 2>&1 \
    || die "签名和 platform/release.pub 对不上（私钥、公钥不是一对？）"
  echo "$SIG" > "$TARBALL.sig"
elif [ -f platform/release.pub ]; then
  die "仓库里有 platform/release.pub（客户机器会要求签名），但没设置 YH_RELEASE_KEY"
fi

# 清单里的下载地址：给了 --base-url 就写完整地址，否则只写文件名（yh 会到 latest.json 所在的目录下找）
URL="$NAME.tar.gz"; [ -n "$BASE_URL" ] && URL="${BASE_URL%/}/$NAME.tar.gz"
jq -n --arg v "$VERSION" --arg u "$URL" --arg s "$SHA" --arg sig "$SIG" --arg min "$MIN" --arg d "$DATE" --arg n "$NOTES" \
  '{version:$v, url:$u, sha256:$s, minVersion:$min, date:$d, notes:$n} + (if $sig == "" then {} else {sig:$sig} end)' > "$OUT/latest.json"

# 安装脚本也放一份：新公司可以 curl <下载地址>/install.sh | bash -s -- --company … 一条命令装（它按同目录的 latest.json 下载更新包）
cp install.sh "$OUT/install.sh"

echo ""
echo "✅ 已生成："
echo "   更新包：${TARBALL}（$(du -h "$TARBALL" | cut -f1 | tr -d ' ')）"
echo "   安装脚本：$OUT/install.sh"
[ -n "$SIG" ] && echo "   签名：  $TARBALL.sig"
echo "   清单：  $OUT/latest.json"
echo "   SHA256：$SHA"
echo ""
echo "接下来："
echo "  1) 把上面的文件传到下载地址的同一个目录（latest.json 的地址 = 客户 yh.env 里的 UPGRADE_URL）"
echo "  2) git tag v$VERSION && git push origin v$VERSION"
echo "  用 GitHub Releases 当下载地址时（latest/download/ 永远指向最新一版，install.sh 默认就从这里装）："
echo "     ./scripts/pack.sh --base-url https://github.com/guoylyy/yihu-one/releases/download/v$VERSION"
echo "     gh release create v$VERSION $OUT/$NAME.tar.gz${SIG:+ $TARBALL.sig} $OUT/latest.json $OUT/install.sh --title v$VERSION --notes-file <更新说明>"
