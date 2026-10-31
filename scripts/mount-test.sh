#!/bin/bash
# 宿主目录挂载自测：清单 deploy.mounts 的校验、yh render 的渲染、宿主路径规则、yh mount、yh up 的衔接、yh check、上报控制台
#
#   ./scripts/mount-test.sh
#
# 不需要 Docker，也不碰本机正在运行的平台：在 /tmp/yh-test 里放一份 yh，HOME 换成假的，docker 和 curl 换成假的（只记录调用、按需应答）。
# 改了 yh 的 mount_* / mounts_* / render_compose / cmd_mount / cmd_render 后跑一遍。
set -uo pipefail

SRC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=/tmp/yh-test; I="$T/inst"; FAKE_HOME="$T/home"
rm -rf "$T"; mkdir -p "$T/bin" "$T/shim" "$I/apps" "$I/platform/caddy/apps" "$I/backups" "$FAKE_HOME/.ssh/sub" "$FAKE_HOME/Library/Keychains" "$FAKE_HOME/笔记 空间/子目录"
trap 'rm -rf "$T"' EXIT
REAL_T="$(cd "$T" && pwd -P)"; REAL_HOME="$REAL_T/home"; REAL_I="$REAL_T/inst"
export SHIM="$T/shim" PATH="$T/bin:$PATH" HOME="$FAKE_HOME"
unset YH_DOCKER

pass=0; fail=0
ok() { pass=$((pass + 1)); printf '\033[32m  ✅ %s\033[0m\n' "$1"; }
ng() { fail=$((fail + 1)); printf '\033[31m  ❌ %s\033[0m\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/     /'; }
title() { printf '\n\033[36m━━ %s\033[0m\n' "$1"; }
yh() { (cd "$I" && /bin/bash ./yh "$@" 2>&1 | LC_ALL=C sed $'s/\033\\[[0-9;]*m//g'; exit "${PIPESTATUS[0]}"); }
run() { out="$(yh "$@")"; rc=$?; } # 结果放在 $out / $rc
said() { grep -qF -- "$1" <<<"$out"; }
yes_() { local n="$1"; shift; if said "$1" && [ "${2:-0}" = "${rc}" ]; then ok "$n"; else ng "$n" "rc=${rc}，要的是「${1}」，实际：$out"; fi; }
# rejected <用例名> <期望文案> <命令参数…>：退出码非 0，且说清了原因
rejected() { local n="$1" w="$2"; shift 2; run "$@"; if [ "$rc" != 0 ] && said "$w"; then ok "$n"; else ng "$n" "rc=${rc}，要的是「${w}」，实际：$out"; fi; }

cat > "$T/bin/docker" <<'SH'
#!/bin/bash
echo "docker $*" >> "$SHIM/docker.log"
case "$*" in
  "ps --format {{.Names}}") echo yh-console; echo yh-mysql;;
  "network inspect"*) [[ "$*" == *" -f "* ]] && echo "yh-caddy yh-console yh-mysql yh-redis";;
  "compose -f "*" up -d"*)
    [ -f "$SHIM/compose-fail" ] && { echo "Error: 假装起不来"; exit 1; }
    # 配置变了才换容器 id：和真实的 docker compose up -d 一样
    f="$3"; sum="$(cksum < "$f")"
    [ "$sum" = "$(cat "$SHIM/sum" 2>/dev/null)" ] || { echo "$sum" > "$SHIM/sum"; echo $(( $(cat "$SHIM/id" 2>/dev/null || echo 0) + 1 )) > "$SHIM/id"; }
    ;;
  "inspect -f {{.Id}} "*) cat "$SHIM/id" 2>/dev/null || exit 1;;
  "inspect -f {{.State.Status}} {{.RestartCount}} "*) if [ -f "$SHIM/crash" ]; then echo "restarting 3"; else echo "running 0"; fi;;
  "inspect -f {{.State.Status}} "*) echo running;;
  "logs "*) echo "chown: ./library: Read-only file system";;
  "exec "*" ls -A "*) [ -f "$SHIM/inside-empty" ] || echo some-file;;
esac
exit 0
SH
printf '#!/bin/bash\nexit 0\n' > "$T/bin/sleep" # 等健康检查不用真等
chmod +x "$T/bin/sleep"
# 假 curl：记下正文，带 -w 的（状态码探测）答 200，其余答控制台的成功
cat > "$T/bin/curl" <<'SH'
#!/bin/bash
w=""; prev=""
for a in "$@"; do
  [ "$prev" = "-d" ] && printf '%s\n' "$a" >> "$SHIM/curl.log"
  [ "$a" = "-w" ] && w=1
  prev="$a"
done
if [ -n "$w" ]; then if [ -f "$SHIM/unhealthy" ]; then printf 000; else printf 200; fi; else printf '{"code":0,"data":{"ok":true,"clientSecret":"s3cret"}}'; fi
SH
chmod +x "$T/bin/docker" "$T/bin/curl"

cp "$SRC_ROOT/yh" "$SRC_ROOT/VERSION" "$I/"
cat > "$I/yh.env" <<'ENV'
PLATFORM_MODE=production
PUBLIC_URL=http://one.localhost:1
LOCAL_HTTP_PORT=1
PLATFORM_TOKEN=x
MYSQL_ROOT_PASSWORD=x
ENV

# new_app <code> <jq 表达式，改默认清单>
new_app() {
  mkdir -p "$I/apps/$1/src"
  jq -n --arg c "$1" '{code:$c, name:$c, version:"1.0.0", port:3000, memory:"512m"}' | jq "${2:-.}" > "$I/apps/$1/src/yh-app.json"
}
mounts() { new_app "$1" ".deploy = {branch:\"release\", mode:\"manual\", mounts:$2}"; } # mounts <code> <JSON 数组>
setenv() { printf '%s=%s\n' "$2" "$3" >> "$I/apps/$1/.env"; }
LIB='{name:"library", container:"/data/library", required:false, description:"知识库目录"}'

title "1. 没声明 mounts 的应用：compose 和改造前逐字节一致"
# 基准是改造前真实运行的 apps/finance/compose.yml
cat > "$T/finance.base" <<'YML'
# yh 生成，勿手改（改 yh-app.json 后重新 yh up finance）
name: yh-finance
services:
  app:
    build: ./src
    image: yh-app-finance:latest
    container_name: yh-finance
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/data
    networks: [yh-app-finance]
    mem_limit: 512m
    cpus: 1.0
    pids_limit: 512
    security_opt: [no-new-privileges:true]
networks:
  yh-app-finance:
    external: true
YML
new_app finance
(cd "$I" && /bin/bash ./yh render finance > "$T/finance.out" 2>"$T/finance.err"); rc=$?
if [ "$rc" = 0 ] && cmp -s "$T/finance.base" "$T/finance.out"; then ok "yh render finance 与改造前逐字节一致"; else ng "yh render finance 与改造前逐字节一致" "$(diff "$T/finance.base" "$T/finance.out"; cat "$T/finance.err")"; fi
[ ! -s "$T/finance.err" ] && ok "没有多余的提示" || ng "没有多余的提示" "$(cat "$T/finance.err")"
new_app imgapp '.image = "nginx:1" | del(.memory) | .cpus = 2'
run render imgapp
said "    image: nginx:1" && said "mem_limit: 256m" && said "cpus: 2" && ! said "build:" && ok "image / 默认内存 / cpus 的写法没变" || ng "image / 默认内存 / cpus 的写法没变" "$out"
new_app noops '.deploy = {branch:"release", mode:"auto"}'
run check "$I/apps/noops/src"
! said "宿主目录挂载" && ok "yh check 对没声明的应用不多一行" || ng "yh check 对没声明的应用不多一行" "$out"
run mount noops
yes_ "yh mount 对没声明的应用只是说明一下" "没有声明宿主目录挂载"

title "2. 已配置：渲染"
mounts knowledge "[$LIB]"
setenv knowledge YH_MOUNT_LIBRARY "$FAKE_HOME/笔记 空间"
run render knowledge
yes_ "默认只读，带引号，路径里有空格和中文" "      - \"$REAL_HOME/笔记 空间:/data/library:ro\""
said "      - ./data:/data" && ok "./data:/data 还在" || ng "./data:/data 还在" "$out"
[ "$(grep -c '^      - ' <<<"$out")" = 2 ] && ok "volumes 只多一行" || ng "volumes 只多一行" "$out"
mounts rwapp '[{name:"up", container:"/mnt/up", mode:"rw", required:true}]'
setenv rwapp YH_MOUNT_UP "$FAKE_HOME/笔记 空间/"
run render rwapp
yes_ "mode 写 rw 才读写；路径末尾的 / 收掉" "      - \"$REAL_HOME/笔记 空间:/mnt/up:rw\""
mounts tilde "[$LIB]"; setenv tilde YH_MOUNT_LIBRARY '~/笔记 空间'
run render tilde
yes_ "~ 展开成绝对路径" "\"$REAL_HOME/笔记 空间:/data/library:ro\""
mounts quoted "[$LIB]"; setenv quoted YH_MOUNT_LIBRARY "\"$FAKE_HOME/笔记 空间\""
run render quoted
yes_ "手写 .env 带引号也认" "\"$REAL_HOME/笔记 空间:/data/library:ro\""
mounts dots "[$LIB]"; setenv dots YH_MOUNT_LIBRARY "$FAKE_HOME/笔记 空间/子目录/.."
run render dots
yes_ ".. 按真实路径算" "\"$REAL_HOME/笔记 空间:/data/library:ro\""
ln -s "$FAKE_HOME/笔记 空间" "$FAKE_HOME/link"
mounts sym "[$LIB]"; setenv sym YH_MOUNT_LIBRARY "$FAKE_HOME/link"
run render sym
yes_ "符号链接：挂校验过的真实路径" "\"$REAL_HOME/笔记 空间:/data/library:ro\""

title "3. 未配置"
mounts knowledge2 '[{name:"library", container:"/data/library", required:true}]'
out="$(cd "$I" && /bin/bash ./yh render knowledge2 2>/dev/null)"
[ -z "$out" ] && ok "必需的没配：标准输出是空的（不会渲染出半份 compose）" || ng "必需的没配：标准输出是空的（不会渲染出半份 compose）" "$out"
rejected "必需的没配：拒绝并给出命令" "yh mount knowledge2 library" render knowledge2
said "应用声明了必需的宿主目录 library，先执行：yh mount knowledge2 library <宿主路径>" && ok "文案和约定的一致" || ng "文案和约定的一致" "$out"
mounts two '[{name:"a", container:"/mnt/a", required:true},{name:"b", container:"/mnt/b", required:true}]'
rejected "两个必需的都没配：都报出来" "yh mount two b" render two
mounts opt "[$LIB]"
(cd "$I" && /bin/bash ./yh render opt > "$T/opt.out" 2>"$T/opt.err"); rc=$?
[ "$rc" = 0 ] && ! grep -q '/data/library' "$T/opt.out" && ok "可选的没配：跳过" || ng "可选的没配：跳过" "$(cat "$T/opt.out")"
grep -q 'yh mount opt library' "$T/opt.err" && ok "可选的没配：警告走 stderr" || ng "可选的没配：警告走 stderr" "$(cat "$T/opt.err")"

title "4. 非法宿主路径：逐条拒绝，说清原因"
bad() { # bad <用例名> <路径> <期望文案>
  mounts badpath "[$LIB]"; rm -f "$I/apps/badpath/.env"; setenv badpath YH_MOUNT_LIBRARY "$2"
  rejected "$1" "$3" render badpath
}
touch "$FAKE_HOME/a-file"
bad "相对路径" "笔记/知识库" "必须是绝对路径"
bad "./ 开头" "./data" "必须是绝对路径"
bad "~别人" "~root/x" "必须是绝对路径"
bad "不存在" "$FAKE_HOME/没有这个目录" "路径不存在"
bad "是文件不是目录" "$FAKE_HOME/a-file" "不是目录"
bad "根目录" "/" "不能挂根目录"
bad "根目录的别名" "/usr/.." "不能挂根目录"
bad "用户主目录" "$FAKE_HOME" "不能挂用户主目录"
bad "用户主目录（~）" "~" "不能挂用户主目录"
bad "用户主目录（符号链接）" "$(ln -s "$FAKE_HOME" "$T/homelink"; echo "$T/homelink")" "不能挂用户主目录"
bad "平台目录" "$I" "不能挂平台自己的目录"
bad "平台目录/apps" "$I/apps" "不能挂平台自己的目录"
bad "平台的子目录" "$I/platform/caddy" "不能挂平台自己的目录"
bad "~/.ssh" "$FAKE_HOME/.ssh" "不能挂 SSH 密钥目录"
bad "~/.ssh 的子目录" "$FAKE_HOME/.ssh/sub" "不能挂 SSH 密钥目录"
bad "~/Library/Keychains" "$FAKE_HOME/Library/Keychains" "不能挂钥匙串目录"
bad "~/Library（包含钥匙串）" "$FAKE_HOME/Library" "包含钥匙串"
bad "/tmp/yh-test（包含平台目录和主目录）" "$T" "包含"
if [ "$(uname)" = "Darwin" ]; then
  bad "大小写绕不过去：~/.SSH" "$FAKE_HOME/.SSH" "不能挂 SSH 密钥目录"
  bad "大小写绕不过去：~/LIBRARY/keychains" "$FAKE_HOME/LIBRARY/keychains" "不能挂钥匙串目录"
fi
for c in ':' '"' '$' '#' '\' '`'; do
  d="$FAKE_HOME/x${c}y"; mkdir -p "$d"
  bad "路径里的 ${c}（compose 没法表示）" "$d" "路径里不能有"
done
mounts dup '[{name:"a", container:"/mnt/a"},{name:"b", container:"/mnt/b"}]'
setenv dup YH_MOUNT_A "$FAKE_HOME/笔记 空间"; setenv dup YH_MOUNT_B "$FAKE_HOME/link"
rejected "同一个宿主目录挂两次（符号链接也算）" "重复挂到了同一个容器" render dup

title "5. 清单写错"
wrong() { # wrong <用例名> <JSON 数组或任意值> <期望文案>
  mounts wrongapp "$2"; rejected "$1" "$3" render wrongapp
  run check wrongapp --strict
  if [ "$rc" != 0 ] && said "❌ 宿主目录挂载" && said "$3"; then ok "$1（yh check 也报）"; else ng "$1（yh check 也报）" "rc=$rc $out"; fi
}
wrong "name 大写" '[{name:"Lib", container:"/mnt/a"}]' "name 要是小写字母开头"
wrong "name 太长" '[{name:"a234567890123456789012345678901234", container:"/mnt/a"}]' "name 要是小写字母开头"
wrong "name 重复" '[{name:"a", container:"/mnt/a"},{name:"a", container:"/mnt/b"}]' "name a 重复"
wrong "container 相对路径" '[{name:"a", container:"mnt/a"}]' "container 要是 / 开头"
wrong "container 是 /" '[{name:"a", container:"/"}]' "container 要是 / 开头"
wrong "container 带 .." '[{name:"a", container:"/data/../etc"}]' "container 要是 / 开头"
wrong "container 带冒号（想偷偷写 mode）" '[{name:"a", container:"/mnt/a:rw"}]' "container 要是 / 开头"
wrong "container 末尾带 /" '[{name:"a", container:"/mnt/a/"}]' "container 要是 / 开头"
wrong "container 是 /data" '[{name:"a", container:"/data"}]' "container 不能是 /data"
wrong "container 是系统目录" '[{name:"a", container:"/etc/app"}]' "容器的系统目录"
wrong "容器路径重复" '[{name:"a", container:"/mnt/a"},{name:"b", container:"/mnt/a"}]' "容器路径 /mnt/a 重复"
wrong "容器路径互相包含" '[{name:"a", container:"/mnt/a"},{name:"b", container:"/mnt/a/b"}]' "/mnt/a 和 /mnt/a/b 互相包含"
wrong "mode 写错" '[{name:"a", container:"/mnt/a", mode:"RW"}]' "mode 只能是 ro 或 rw"
wrong "required 不是布尔" '[{name:"a", container:"/mnt/a", required:"yes"}]' "required 要是 true 或 false"
wrong "mounts 不是数组" '{name:"a"}' "deploy.mounts 要是数组"
wrong "数组项不是对象" '["/mnt/a"]' "要是对象"
mounts prefix '[{name:"a", container:"/mnt/a"},{name:"b", container:"/mnt/ab"}]'
run render prefix
[ "$rc" = 0 ] && ok "/mnt/a 和 /mnt/ab 不算互相包含" || ng "/mnt/a 和 /mnt/ab 不算互相包含" "$out"

title "6. yh check"
mounts chk "[$LIB]"
run check chk
said "⚠️ 宿主目录挂载" && said "yh mount chk library" && [ "$rc" = 0 ] && ok "可选没配：⚠️，不是硬错误" || ng "可选没配：⚠️，不是硬错误" "$out"
run check chk --strict
[ "$(grep -c '❌ 宿主目录挂载' <<<"$out")" = 0 ] && ok "--strict 下未配置也不算 ❌" || ng "--strict 下未配置也不算 ❌" "$out"
setenv chk YH_MOUNT_LIBRARY "$FAKE_HOME/笔记 空间"
run check chk
yes_ "配好了：✅" "1 个已配置"
setenv chk YH_MOUNT_LIBRARY "/"
run check chk --strict
[ "$rc" != 0 ] && said "❌ 宿主目录挂载" && ok "配了但不合格：❌" || ng "配了但不合格：❌" "$out"

title "7. yh mount"
mounts km "[$LIB]"
: > "$SHIM/docker.log"; : > "$SHIM/curl.log"
run mount km
yes_ "列出声明和当前值" "未配置：yh mount km library <宿主路径>"
said "library → /data/library（只读，可选）" && said "知识库目录" && ok "容器路径、模式、说明都有" || ng "容器路径、模式、说明都有" "$out"
run mount km nothing
[ "$rc" != 0 ] && said "没有声明 nothing" && ok "看一个不存在的名称：报错" || ng "看一个不存在的名称：报错" "$out"
rejected "设置不存在的名称" "没有声明 nothing" mount km nothing "$FAKE_HOME/笔记 空间"
rejected "路径有空格忘了加引号" "参数太多" mount km library /a b
rejected "设置时路径不合格：什么都不写" "不能挂根目录" mount km library /
grep -q YH_MOUNT "$I/apps/km/.env" 2>/dev/null && ng "拒绝后 .env 没有被写" || ok "拒绝后 .env 没有被写"
rejected "没有这个应用" "没有应用 ghost" mount ghost

touch "$FAKE_HOME/笔记 空间/1.md" "$FAKE_HOME/笔记 空间/子目录/2.md"
yh render km >/dev/null; printf 'stale\n' > "$I/apps/km/compose.yml"; # 假装上线过
run mount km library "~/笔记 空间"
yes_ "设置成功" "✅ 已生效"
for w in "变量：YH_MOUNT_LIBRARY（apps/km/.env）" "宿主：$REAL_HOME/笔记 空间" "容器：/data/library（只读）" "文件：2 个" "容器：已重建并重启 yh-km（没有重建镜像）"; do
  said "$w" && ok "输出说清了 $w" || ng "输出说清了 $w" "$out"
done
grep -qxF "YH_MOUNT_LIBRARY=$REAL_HOME/笔记 空间" "$I/apps/km/.env" && ok ".env 写的是展开后的真实路径" || ng ".env 写的是展开后的真实路径" "$(cat "$I/apps/km/.env")"
[ "$(stat -f %Lp "$I/apps/km/.env" 2>/dev/null || stat -c %a "$I/apps/km/.env")" = 600 ] && ok ".env 权限还是 600" || ng ".env 权限还是 600"
grep -qF "      - \"$REAL_HOME/笔记 空间:/data/library:ro\"" "$I/apps/km/compose.yml" && ok "compose.yml 重新渲染了" || ng "compose.yml 重新渲染了" "$(cat "$I/apps/km/compose.yml")"
grep -q 'compose -f .* up -d$' "$SHIM/docker.log" && ok "执行了 docker compose up -d" || ng "执行了 docker compose up -d" "$(cat "$SHIM/docker.log")"
grep -qE -- '--build|docker build' "$SHIM/docker.log" && ng "没有重建镜像" "$(cat "$SHIM/docker.log")" || ok "没有重建镜像"
grep -q '"mounts":\[{"name":"library"' "$SHIM/curl.log" && ok "设完立刻上报控制台" || ng "设完立刻上报控制台" "$(cat "$SHIM/curl.log")"
[ ! -d "$I/.deploy.lock" ] && ok "发布锁释放了" || ng "发布锁释放了"
run mount km library "~/笔记 空间"
yes_ "同样的值再设一次：容器不重启" "配置没变，没有重启"
run mount km library
yes_ "只看一项：显示当前值" "YH_MOUNT_LIBRARY=$REAL_HOME/笔记 空间"
mkdir -p "$FAKE_HOME/空目录"
run mount km library "$FAKE_HOME/空目录"
yes_ "目录是空的：提醒确认" "这个目录里没有文件"
touch "$SHIM/inside-empty"; run mount km library "$FAKE_HOME/笔记 空间"
yes_ "宿主有文件容器里却是空的：提醒文件共享" "Docker 没拿到这个目录"
rm -f "$SHIM/inside-empty"

touch "$SHIM/compose-fail"
rejected "容器起不来：报错" "没有改动" mount km library "$FAKE_HOME/笔记 空间/子目录"
rm -f "$SHIM/compose-fail"
grep -qxF "YH_MOUNT_LIBRARY=$REAL_HOME/笔记 空间" "$I/apps/km/.env" && ok "容器起不来：.env 恢复原值" || ng "容器起不来：.env 恢复原值" "$(cat "$I/apps/km/.env")"
grep -qF "\"$REAL_HOME/笔记 空间:/data/library:ro\"" "$I/apps/km/compose.yml" && ok "容器起不来：compose 恢复原值" || ng "容器起不来：compose 恢复原值"

# 真机上踩到的：镜像入口 chown -R /data 碰到 /data 下的只读挂载，容器反复重启。不能报「已生效」
touch "$SHIM/unhealthy" "$SHIM/crash"
rejected "容器起来就崩：不能说已生效" "没有改动" mount km library "$FAKE_HOME/笔记 空间/子目录"
said "✅" && ng "容器起来就崩：没有 ✅" "$out" || ok "容器起来就崩：没有 ✅"
said "容器起不来（restarting 3）" && said "Read-only file system" && ok "容器起来就崩：带上状态和容器日志" || ng "容器起来就崩：带上状态和容器日志" "$out"
grep -qxF "YH_MOUNT_LIBRARY=$REAL_HOME/笔记 空间" "$I/apps/km/.env" && ok "容器起来就崩：恢复原来的配置" || ng "容器起来就崩：恢复原来的配置" "$(cat "$I/apps/km/.env")"
rm -f "$SHIM/crash"
run mount km library "$FAKE_HOME/笔记 空间/子目录"
yes_ "容器在运行但健康检查没过：挂载留着，如实说" "挂载已生效，但应用不健康"
said "✅" && ng "健康检查没过：没有 ✅" "$out" || ok "健康检查没过：没有 ✅"
rm -f "$SHIM/unhealthy"
run mount km library "$FAKE_HOME/笔记 空间"

touch "$I/apps/km/.stopped"; : > "$SHIM/docker.log"
run mount km library "$FAKE_HOME/笔记 空间/子目录"
yes_ "停用的应用：只改配置，不启动" "容器没动"
grep -q 'compose' "$SHIM/docker.log" && ng "停用的应用：没有 compose up" "$(cat "$SHIM/docker.log")" || ok "停用的应用：没有 compose up"
rm -f "$I/apps/km/.stopped"

run mount km library --clear
yes_ "清除可选挂载" "已清除 YH_MOUNT_LIBRARY"
grep -q YH_MOUNT "$I/apps/km/.env" && ng "清除后 .env 里没有了" || ok "清除后 .env 里没有了"
grep -q '/data/library' "$I/apps/km/compose.yml" && ng "清除后 compose 里没有了" || ok "清除后 compose 里没有了"
run mount km library --clear
yes_ "再清除一次：说明本来就没配" "本来就没配置"

mounts req '[{name:"library", container:"/data/library", required:true}]'
setenv req YH_MOUNT_LIBRARY "$FAKE_HOME/笔记 空间"
printf 'x\n' > "$I/apps/req/compose.yml"
run mount req library --clear
yes_ "清除必需的挂载：说清容器还在用、怎么断开" "yh down req"
rejected "清除必需的挂载后再 render 报错（符合预期）" "yh mount req library" render req

mounts samehost '[{name:"a", container:"/mnt/a"},{name:"b", container:"/mnt/b"}]'
setenv samehost YH_MOUNT_A "$FAKE_HOME/笔记 空间"
rejected "yh mount 也拒绝同一个宿主目录挂两次" "重复挂到了同一个容器" mount samehost b "$FAKE_HOME/link"
grep -q YH_MOUNT_B "$I/apps/samehost/.env" && ng "拒绝后 B 没写进 .env" || ok "拒绝后 B 没写进 .env"

title "8. yh up 的衔接"
# 清单的 env 不能决定挂哪里：员工提交的清单是不可信输入
mounts evil "[$LIB]"
jq '.env = {YH_MOUNT_LIBRARY: "/etc", OK_VAR: "1"}' "$I/apps/evil/src/yh-app.json" > "$T/m" && mv "$T/m" "$I/apps/evil/src/yh-app.json"
run up evil
yes_ "清单 env 里的 YH_MOUNT_* 被忽略" "清单 env 里的 YH_MOUNT_LIBRARY 已忽略"
grep -q '^YH_MOUNT' "$I/apps/evil/.env" && ng "清单没能写进 .env" "$(cat "$I/apps/evil/.env")" || ok "清单没能写进 .env"
grep -q '^OK_VAR=1' "$I/apps/evil/.env" && ok "其他 env 照常" || ng "其他 env 照常"
said "⚠️ 宿主目录 library 未配置（可选，这次没挂）：yh mount evil library <宿主路径>" && ok "可选没配：日志末尾有提示和命令" || ng "可选没配：日志末尾有提示和命令" "$out"
[ "$(tail -1 <<<"$out" | grep -c 'yh mount evil')" = 1 ] && ok "提示在最后一行（控制台操作日志的末尾）" || ng "提示在最后一行" "$out"

# 改造前真实的 finance：yh up 写出来的 compose.yml 一样逐字节不变
run up finance
cmp -s "$T/finance.base" "$I/apps/finance/compose.yml" && ok "yh up finance 写出的 compose.yml 与改造前逐字节一致" || ng "yh up finance 写出的 compose.yml 与改造前逐字节一致" "$(diff "$T/finance.base" "$I/apps/finance/compose.yml")"
: > "$SHIM/curl.log"; run up finance
jq -se 'map(select(.code == "finance"))[0].mounts == []' "$SHIM/curl.log" >/dev/null && ok "登记时上报 mounts（旧应用是空数组）" || ng "登记时上报 mounts（旧应用是空数组）" "$(cat "$SHIM/curl.log")"

# 控制台安装的场景：必需目录没配。要拒绝上线，但控制台得知道（登记了才能标红），应用也不能被当成装失败清掉
mounts inst '[{name:"library", container:"/data/library", required:true, description:"知识库"}]'
: > "$SHIM/curl.log"; : > "$SHIM/docker.log"
rejected "yh up：必需的没配，拒绝" "yh mount inst library" up inst
jq -se 'map(select(.code == "inst"))[0].mounts[0] | .name == "library" and .required and .configured == false and .description == "知识库"' "$SHIM/curl.log" >/dev/null && ok "拒绝之前已经登记到控制台（列表能标红）" || ng "拒绝之前已经登记到控制台（列表能标红）" "$(cat "$SHIM/curl.log")"
[ -n "$(grep '^YH_CLIENT_ID=' "$I/apps/inst/.env")" ] && ok "已登记：控制台安装失败时 apps/inst 不会被清理" || ng "已登记：控制台安装失败时 apps/inst 不会被清理"
[ ! -f "$I/apps/inst/compose.yml" ] && ok "没写 compose、没起容器" || ng "没写 compose、没起容器"
grep -q 'compose' "$SHIM/docker.log" && ng "没有 docker compose" "$(cat "$SHIM/docker.log")" || ok "没有 docker compose"
run mount inst library "$FAKE_HOME/笔记 空间"
yes_ "yh mount 补上后接着上线" "已上线"
grep -qF "\"$REAL_HOME/笔记 空间:/data/library:ro\"" "$I/apps/inst/compose.yml" && ok "上线后的 compose 带上了挂载" || ng "上线后的 compose 带上了挂载"
[ ! -f "$I/apps/inst/.mounts-pending.json" ] && ok "上线成功后清掉待补的清单" || ng "上线成功后清掉待补的清单"

# 非法路径要在任何改动之前拒绝
mounts early "[$LIB]"; setenv early YH_MOUNT_LIBRARY "/"
: > "$SHIM/curl.log"
rejected "yh up：路径不合格，拒绝" "不能挂根目录" up early
[ ! -s "$SHIM/curl.log" ] && ok "路径不合格：没登记、没动数据库" || ng "路径不合格：没登记、没动数据库" "$(cat "$SHIM/curl.log")"
mounts earlym '[{name:"a", container:"/data"}]'
: > "$SHIM/curl.log"
rejected "yh up：清单写错，拒绝" "container 不能是 /data" up earlym
[ ! -s "$SHIM/curl.log" ] && ok "清单写错：没登记" || ng "清单写错：没登记"

# 新版本多要一个必需目录，发布失败回滚：当前清单回到旧版本，管理员照着报错执行 yh mount 不能走进死路
mounts rb "[$LIB]"
setenv rb YH_MOUNT_LIBRARY "$FAKE_HOME/笔记 空间"
run up rb
cp "$I/apps/rb/src/yh-app.json" "$T/rb.old"
mounts rb '[{name:"library", container:"/data/library"},{name:"archive", container:"/data/archive", required:true}]'
rejected "新版本要新的必需目录：拒绝上线" "yh mount rb archive" up rb
cp "$T/rb.old" "$I/apps/rb/src/yh-app.json" # 回滚
run mount rb archive "$FAKE_HOME/笔记 空间/子目录"
yes_ "回滚后照着报错配置：保存下来，说清什么时候生效" "重新发布后生效：yh update rb"
grep -q '^YH_MOUNT_ARCHIVE=' "$I/apps/rb/.env" && ok "写进了 .env" || ng "写进了 .env"
mounts rb '[{name:"library", container:"/data/library"},{name:"archive", container:"/data/archive", required:true}]'
run up rb
grep -q ':/data/archive:ro"' "$I/apps/rb/compose.yml" && ok "重新发布后生效" || ng "重新发布后生效" "$out"

title "9. 状态上报"
# yh mount 设完会走一遍 agent 同样的 report_status，所有应用的状态都在这一条里
: > "$SHIM/curl.log"
run mount rb library "$FAKE_HOME/笔记 空间"
grep '^{"apps":' "$SHIM/curl.log" | tail -1 | jq .apps > "$T/status.json"
jq -e 'map(select(.code == "rb"))[0].mounts | length == 2 and all(.configured)' "$T/status.json" >/dev/null && ok "status_json 带上挂载配置" || ng "status_json 带上挂载配置" "$(cat "$T/status.json")"
jq -e 'map(select(.code == "finance"))[0].mounts == []' "$T/status.json" >/dev/null && ok "旧应用是空数组" || ng "旧应用是空数组"
jq -e 'map(select(.code == "wrongapp"))[0].mounts == null' "$T/status.json" >/dev/null && ok "清单写错：null（控制台保留原来的）" || ng "清单写错：null（控制台保留原来的）"
jq -e 'map(select(.code == "chk"))[0].mounts[0] | .configured == false and (.problem | test("根目录"))' "$T/status.json" >/dev/null && ok "配了但不合格：带上原因，不算已配置" || ng "配了但不合格：带上原因，不算已配置"

title "10. Docker 安装：yh 在容器里，看不到宿主机目录"
mounts dk "[$LIB]"; setenv dk YH_MOUNT_LIBRARY "/volume1/笔记 空间/"
out="$(cd "$I" && YH_DOCKER=1 /bin/bash ./yh render dk 2>&1)"; rc=$?
yes_ "按字面检查，路径存不存在交给管理员" "      - \"/volume1/笔记 空间:/data/library:ro\""
out="$(cd "$I" && rm -f apps/dk/.env && printf 'YH_MOUNT_LIBRARY=/volume1/../etc\n' > apps/dk/.env && YH_DOCKER=1 /bin/bash ./yh render dk 2>&1)"; rc=$?
[ "$rc" != 0 ] && said "不能有 . 或 .." && ok "字面检查也拒绝 .." || ng "字面检查也拒绝 .." "$out"
out="$(cd "$I" && printf 'YH_MOUNT_LIBRARY=/\n' > apps/dk/.env && YH_DOCKER=1 /bin/bash ./yh render dk 2>&1)"; rc=$?
[ "$rc" != 0 ] && said "不能挂根目录" && ok "字面检查也拒绝 /" || ng "字面检查也拒绝 /" "$out"

printf '\n通过 %s，失败 %s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
