#!/bin/bash
# 平台升级自测：打包（scripts/pack.sh）→ yh upgrade 的各条路径（联网 / 离线包 / 失败回滚 / 校验 / 签名 / agent 重启）
#
#   ./scripts/upgrade-test.sh
#
# 不需要 Docker，也不碰本机正在运行的平台：在临时目录里装一份平台，docker 换成假的（只记录调用、按需模拟失败），
# 控制台换成一个只会应答的假服务。改了 yh 的升级部分或 scripts/pack.sh 后跑一遍；控制台那一侧由后端单测覆盖。
set -uo pipefail

SRC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(cd "${TMPDIR:-/tmp}" && pwd)/yh-upgrade-test"; I="$T/inst"; PORT=18997; APID=""
for c in git jq node openssl curl; do command -v "$c" >/dev/null 2>&1 || { echo "缺少 $c"; exit 1; }; done
curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" && { echo "端口 $PORT 被占用"; exit 1; }
rm -rf "$T"; mkdir -p "$T/bin" "$T/vendor"
export SHIM="$T/shim" SHIM_ROOT="$I" PATH="$T/bin:$PATH" YH_PACK_SKIP_TESTS=1

pass=0; fail=0
ok() { pass=$((pass + 1)); printf '\033[32m  ✅ %s\033[0m\n' "$1"; }
ng() { fail=$((fail + 1)); printf '\033[31m  ❌ %s\033[0m\n' "$1"; }
t() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else ng "$name"; fi; }
nt() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ng "$name"; else ok "$name"; fi; }
title() { printf '\n\033[36m━━ %s\033[0m\n' "$1"; }
yh() { (cd "$I" && /bin/bash ./yh "$@" 2>&1 | LC_ALL=C sed $'s/\033\\[[0-9;]*m//g'; exit "${PIPESTATUS[0]}"); }
ver_is() { [ "$(cat "$I/VERSION")" = "$1" ]; }
said() { grep -q -- "$1" <<<"$out"; }

# ---- 假 docker：记下调用；按 $SHIM 里的开关模拟「新版本构建失败」「新版本改完数据库后起不来」
cat > "$T/bin/docker" <<'SH'
#!/bin/bash
echo "docker $*" >> "$SHIM/docker.log"
V="$(cat "$SHIM_ROOT/VERSION" 2>/dev/null)"
case "$*" in
  *mysqldump*) echo "-- dump; migrations: $(cat "$SHIM/migrations")";;
  *_prisma_migrations*) cat "$SHIM/migrations";;
  *"DROP DATABASE"*) echo "drop+create" >> "$SHIM/db.log";;
  "exec -i yh-mysql mysql -uroot -p"*" yh_console") cat > "$SHIM/restored.sql"; echo "restore" >> "$SHIM/db.log"; cp "$SHIM/migrations.orig" "$SHIM/migrations";;
  compose*"build console"*) [ "$V" = "$(cat "$SHIM/fail-build" 2>/dev/null)" ] && echo "ERROR: simulated build failure for $V";;
  compose*"up -d") if [ "$V" = "$(cat "$SHIM/fail-up" 2>/dev/null)" ]; then echo "99990101_new_migration:1" >> "$SHIM/migrations"; echo "simulated: console crashed after migrating"; exit 1; fi;;
esac
exit 0
SH
chmod +x "$T/bin/docker"

# ---- 假控制台：ping 应答，其余请求记到 console.log
cat > "$T/console.mjs" <<'JS'
import http from 'node:http'
import fs from 'node:fs'
const [log, port] = process.argv.slice(2)
http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    let c = b; try { c = JSON.stringify(JSON.parse(b)) } catch {}
    if (req.url !== '/api/platform/ping') fs.appendFileSync(log, `${req.method} ${req.url} ${c}\n`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(req.url === '/api/platform/ops/claim' ? '{"code":0,"data":{"id":null}}' : '{"code":0,"data":{"ok":true}}')
  })
}).listen(Number(port), '127.0.0.1')
JS
node "$T/console.mjs" "$T/console.log" "$PORT" & CPID=$!
trap 'kill $CPID $APID 2>/dev/null' EXIT # agent 重启是 exec，进程号不变

# ---- 发布方仓库：当前代码（含没提交的改动）复制一份，依次打出 A（当前版本）→ B → C（带签名）三个版本的包
title "打包"
(cd "$SRC_ROOT" && { git -c core.quotepath=off ls-files; git -c core.quotepath=off ls-files -o --exclude-standard; } | sort -u) | while IFS= read -r f; do
  [ -f "$SRC_ROOT/$f" ] || continue
  mkdir -p "$T/vendor/$(dirname "$f")"; cp -p "$SRC_ROOT/$f" "$T/vendor/$f"
done
VA="$(tr -d '[:space:]' < "$SRC_ROOT/VERSION")"; VB="98.0.0"; VC="98.1.0"
g() { git -C "$T/vendor" -c user.name=test -c user.email=test@example.com "$@"; }
pack() { # pack <输出目录> [pack.sh 参数…]
  local dir="$1"; shift
  mkdir -p "$dir"; (cd "$T/vendor" && /bin/bash scripts/pack.sh "$@" > "$T/pack.log" 2>&1); local rc=$?
  mv "$T/vendor"/dist/* "$dir/" 2>/dev/null; rm -rf "$T/vendor/dist"; return $rc
}
g init -q; echo "旧版本才有的文件" > "$T/vendor/docs/obsolete.md"; rm -f "$T/vendor/platform/release.pub"
g add -A; g commit -q -m "版本 A"
t "打出 ${VA} 的包" pack "$T/a" --notes "版本 A"
g tag "v$VA"
t "包里没有只给发布方用的文件" sh -c "! tar -tzf $T/a/yihu-one-$VA.tar.gz | grep -E '/(CLAUDE\.md|release\.sh|scripts/pack\.sh)$'"
t "包里带文件清单和发布信息" sh -c "tar -tzf $T/a/yihu-one-$VA.tar.gz | grep -q '/\.yh-files$' && tar -tzf $T/a/yihu-one-$VA.tar.gz | grep -q '/\.yh-release$'"
echo "$VB" > "$T/vendor/VERSION"; echo "新版本才有的文件" > "$T/vendor/docs/new-in-b.md"; g rm -q docs/obsolete.md
mkdir -p "$T/vendor/console/backend/prisma/migrations/99990101000000_test"; echo "-- test" > "$T/vendor/console/backend/prisma/migrations/99990101000000_test/migration.sql"
g add -A; g commit -q -m "版本 B：加一个文件、删一个文件"
t "打出 ${VB} 的包" pack "$T/b"
t "更新说明取自上个标签之后的提交" grep -q '版本 B：加一个文件、删一个文件' "$T/b/latest.json"
t "有未提交的改动时拒绝打包" sh -c "echo x >> $T/vendor/README.md; ! (cd $T/vendor && /bin/bash scripts/pack.sh); git -C $T/vendor checkout -q README.md"
pack "$T/min" --min 98.5.0

fresh() { # 装一份版本 A（更新包安装），更新地址指向 <目录>/latest.json
  rm -rf "$I" "$SHIM"; mkdir -p "$I" "$SHIM"
  tar -xzf "$T/a/yihu-one-$VA.tar.gz" -C "$I" --strip-components=1
  cat > "$I/yh.env" <<ENV
PLATFORM_MODE=test
PUBLIC_URL=http://localhost:$PORT
LOCAL_HTTP_PORT=$PORT
MYSQL_ROOT_PASSWORD=x
CONSOLE_DB_PASSWORD=x
CONSOLE_JWT_SECRET=xxxxxxxxxxxxxxxx
CONSOLE_SECRET_KEY=xxxxxxxxxxxxxxxx
PLATFORM_TOKEN=tttttttttttttttttttttttttttttt
UPGRADE_URL=file://${1:-$T/b}/latest.json
ENV
  mkdir -p "$I/apps/demo"; echo keep > "$I/apps/demo/data.txt"
  printf '20260928000000_init:1\n' > "$SHIM/migrations"; cp "$SHIM/migrations" "$SHIM/migrations.orig"
  : > "$T/console.log"
}

title "查新版本"
fresh
out="$(yh upgrade --check)"
t "提示有新版本" said "有新版本 $VB"
t "把当前版本和最新版本报给控制台" grep -q "POST /api/platform/info .*\"version\":\"$VA\",\"mode\":\"package\".*\"latest\":{\"version\":\"$VB\"" "$T/console.log"

title "联网升级"
ino="$(ls -i "$I/yh" | awk '{print $1}')"
out="$(yh upgrade)"; rc=$?
t "升级成功" [ "$rc" = 0 ]
t "版本变成 ${VB}" ver_is "$VB"
t "新文件装上了" [ -f "$I/docs/new-in-b.md" ]
t "新版本里没有的文件删掉了" [ ! -e "$I/docs/obsolete.md" ]
t "yh 是换文件，不是原地改写（常驻 agent 不会读到半新半旧）" [ "$(ls -i "$I/yh" | awk '{print $1}')" != "$ino" ]
t "yh.env、应用数据没动" sh -c "grep -qx keep $I/apps/demo/data.txt && grep -q '^PLATFORM_TOKEN=tttt' $I/yh.env"
t "备份了平台文件和控制台数据库" sh -c "ls $I/backups/upgrade/*-$VA/code.tar.gz $I/backups/upgrade/*-$VA/yh_console.sql.gz"
t "重新构建了控制台" grep -q 'build console' "$SHIM/docker.log"
t "发布记录报给控制台" grep -q "POST /api/platform/deploys .*\"appCode\":\"platform\",\"result\":\"成功\",\"version\":\"$VB\"" "$T/console.log"
t "发布锁已释放" [ ! -e "$I/.deploy.lock" ]
out="$(yh upgrade)"; t "再升一次：已是最新" said "已是最新（${VB}）"

title "新版本构建失败 → 回滚（数据库结构没变，不动数据库）"
fresh; echo "$VB" > "$SHIM/fail-build"
out="$(yh upgrade)"; rc=$?
t "升级失败" [ "$rc" != 0 ]
t "版本回到 ${VA}" ver_is "$VA"
t "新版本多出来的文件删掉了" [ ! -e "$I/docs/new-in-b.md" ]
t "多出来的数据库迁移也清掉了" [ ! -e "$I/console/backend/prisma/migrations/99990101000000_test" ]
t "被删的文件恢复了" [ -f "$I/docs/obsolete.md" ]
nt "没有动数据库" grep -q restore "$SHIM/db.log"
t "发布记录：回滚" grep -q '"result":"回滚"' "$T/console.log"
t "发布锁已释放" [ ! -e "$I/.deploy.lock" ]

title "新版本改了数据库结构后起不来 → 回滚并恢复数据库"
fresh; echo "$VB" > "$SHIM/fail-up"
out="$(yh upgrade)"; rc=$?
t "升级失败" [ "$rc" != 0 ]
t "版本回到 ${VA}" ver_is "$VA"
t "先删库重建，再导入备份" [ "$(tr '\n' ' ' < "$SHIM/db.log")" = "drop+create restore " ]
t "导入的是升级前的备份" grep -q 'dump; migrations: 20260928000000_init:1' "$SHIM/restored.sql"

title "离线包"
fresh; sed -i.bak '/^UPGRADE_URL=/d' "$I/yh.env"
out="$(yh upgrade)"; rc=$?
t "没配更新地址：报错并提示离线办法" sh -c "[ $rc != 0 ]"; t "  …提示 yh upgrade --package" said 'yh upgrade --package'
out="$(yh upgrade --package "$T/a/yihu-one-$VA.tar.gz")"; t "同版本的包：不升级" said "不高于当前 $VA"
out="$(yh upgrade --package "$T/b/yihu-one-$VB.tar.gz")"; t "用新版本的包升级成功" ver_is "$VB"
echo junk > "$T/junk.tar.gz"; out="$(yh upgrade --package "$T/junk.tar.gz")"; rc=$?
t "不是更新包：报错" [ "$rc" != 0 ]; t "  …什么都没改" ver_is "$VB"

title "校验"
mkdir -p "$T/bad"; cp "$T/b/yihu-one-$VB.tar.gz" "$T/bad/"; jq '.sha256 = "0000"' "$T/b/latest.json" > "$T/bad/latest.json"
fresh "$T/bad"
out="$(yh upgrade)"; rc=$?
t "SHA256 对不上：中止" said 'SHA256 对不上'; t "  …什么都没改" ver_is "$VA"; nt "  …也没留下备份" sh -c "ls -d $I/backups/upgrade/2*"
out="$(yh upgrade --package "$T/min/yihu-one-$VB.tar.gz")"; rc=$?
t "低于最低可升级版本：拒绝" said '不低于 98.5.0'

title "从 Git 安装的机器"
out="$(cp "$I/yh.env" "$T/vendor/yh.env"; cd "$T/vendor" && /bin/bash ./yh upgrade 2>&1; rm -f "$T/vendor/yh.env")"
t "拒绝 yh upgrade，说明走 release 分支" said '从 Git 安装的'

title "签名"
openssl genrsa -out "$T/release.key" 2048 2>/dev/null
openssl rsa -in "$T/release.key" -pubout -out "$T/vendor/platform/release.pub" 2>/dev/null
echo "$VC" > "$T/vendor/VERSION"; g add -A; g commit -q -m "版本 C：带签名公钥"
pack "$T/nokey"; t "仓库里有公钥但没给私钥：拒绝打包" grep -q '没设置 YH_RELEASE_KEY' "$T/pack.log"
YH_RELEASE_KEY="$T/release.key" pack "$T/c"
t "打包产出签名文件" [ -s "$T/c/yihu-one-$VC.tar.gz.sig" ]
t "清单里带签名" jq -e '.sig | length > 100' "$T/c/latest.json"
fresh; cp "$T/vendor/platform/release.pub" "$I/platform/release.pub"
out="$(yh upgrade --package "$T/b/yihu-one-$VB.tar.gz")"; rc=$?
t "要求签名的机器：没签名的包被拒绝" said '没有找到签名文件'; t "  …什么都没改" ver_is "$VA"
cp "$T/c/yihu-one-$VC.tar.gz" "$T/bad/tampered.tar.gz"; cp "$T/c/yihu-one-$VC.tar.gz.sig" "$T/bad/tampered.tar.gz.sig"; printf 'x' >> "$T/bad/tampered.tar.gz"
out="$(yh upgrade --package "$T/bad/tampered.tar.gz")"; rc=$?
t "包被改过：签名校验不通过" said '签名校验不通过'; t "  …什么都没改" ver_is "$VA"
out="$(yh upgrade --package "$T/c/yihu-one-$VC.tar.gz")"
t "离线包 + 旁边的 .sig：校验通过" said '签名校验通过'; t "  …升级到 ${VC}" ver_is "$VC"
fresh "$T/c"; cp "$T/vendor/platform/release.pub" "$I/platform/release.pub"
out="$(yh upgrade)"
t "联网升级：用清单里的签名校验通过" said '签名校验通过'; t "  …升级到 ${VC}" ver_is "$VC"

title "常驻 agent"
fresh
(cd "$I" && WATCH_INTERVAL=3600 exec /bin/bash ./yh agent > "$T/agent.log" 2>&1) & APID=$!
sleep 8
t "启动后自动查到新版本" grep -q "有新版本 $VB" "$T/agent.log"
t "定时上报里带平台版本" grep -q "POST /api/platform/info .*\"version\":\"$VA\"" "$T/console.log"
yh upgrade >/dev/null 2>&1
sleep 9
t "升级后 agent 换成新版本的脚本重启" grep -q "平台已从 $VA 更新到 ${VB}，重启 agent" "$T/agent.log"
t "  …重启后继续运行" [ "$(grep -c 'yh agent 启动' "$T/agent.log")" = 2 ]
kill "$APID" 2>/dev/null; wait "$APID" 2>/dev/null; APID=""

printf '\n通过 %s，失败 %s\n' "$pass" "$fail"
if [ "$fail" = 0 ]; then rm -rf "$T"; else echo "现场保留在 $T"; fi
[ "$fail" = 0 ]
