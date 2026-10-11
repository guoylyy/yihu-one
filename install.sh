#!/bin/bash
# 以虎 One 安装脚本：给一家新公司从零装一套完整的平台（bash 3.2 兼容，macOS / Linux）。完整步骤见 docs/部署手册.md
#
#   本机试用（几分钟，http://localhost:18080，带开发登录）：
#     ./install.sh --test --demo
#
#   给一家公司正式安装（推荐：平台机器在内网，公网云服务器只做 HTTPS + 隧道转发）：
#     ./install.sh --company acme --url https://one.example.com --apps-url https://apps.one.example.com \
#                  --frp-server 1.2.3.4 --cn --demo
#
#   没有代码时一条命令安装（从发布页下载最新更新包）：
#     curl -fsSL https://github.com/guoylyy/yihu-one/releases/latest/download/install.sh | bash -s -- --company acme --url https://...
#
# 参数
#   --company <代号>      公司代号（小写英文，如 acme），写进 yh.env 和交付单
#   --url <访问地址>      控制台地址，如 https://one.example.com
#   --apps-url <地址>     应用独立域名，如 https://apps.one.example.com（生产强烈建议配：应用页面拿不到控制台登录凭证）
#   --frp-server <IP>     云服务器公网 IP：平台机器在内网、经隧道对外时填（不填 = 自己在前面配反代）
#   --cn                  国内网络：Docker 镜像、npm、Prisma 引擎走国内镜像
#   --demo                装两个演示应用（Node / Python），装完马上能体验统一登录、AI 工具
#   --no-openhex          构建控制台时不带 OpenHex 模型接入（其协议未定，对外分发时用）
#   --dir <目录>          装到哪里（默认 ~/yihu-one）
#   --src <包或地址>      更新包（.tar.gz）的本地路径或地址，或更新清单 latest.json 的地址
#   --allow-unsigned      允许装没有签名的更新包（只用于 0.1.0 等签名之前的版本）
#   --upgrade-url <地址>  以后查新版本用的 latest.json 地址（默认本项目发布页）；--offline 表示不联网查
#   --git                 原地用当前 Git 检出安装，自动跟踪 release 分支（只用于自己维护、要跟最新代码的实例）
#   --no-autostart        不装开机自启 / 常驻 agent（不建议：控制台里的插拔操作靠 agent 执行）
#   --yes                 不确认直接装
#   --test [--lan]        本机试用（--lan 让局域网里的电脑也能打开）
#
# 安装方式：公司正式安装用「更新包方式」（目录里没有 .git）：版本由你们决定什么时候升，管理员在控制台点「升级」或拷更新包，
# 升级前自动备份、失败自动回滚；不会因为有人推了代码就自动更新。从 Git 检出里执行时，脚本用 git archive 导出当前版本来装。
set -uo pipefail

RELEASES="https://github.com/guoylyy/yihu-one/releases/latest/download"
# 发布方的签名公钥（和 platform/release.pub 一样，单元测试校验两处一致）：下载 / 拷来的更新包必须带对得上的签名才装。
# 不能用包里自带的公钥校验包自己，所以写死在这里
RELEASE_PUB="-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAunBdxxYycnbjBxezLt2A
4Y61vvqZ1QKkIm9MpxNedHpFLwnPl+yqA+4lmVjAzxZeOR2In3bqxAe5VkAkqPxK
CpvZgRwgZqpMMDDgLFm/5aVk1W5uHgsPUmlU1Ucv4yOuqyvYlE3dSU8hj4gON4Hv
18SH5sRjP0obn0mxHcP59DFGZGzMc+qWRWlpfWg7iu8Q0zD9LDQq52cM1w8wfrFe
reO8qYoO4lKUmstC/Yr3BmAcqtv5pz65J+5DNF5Ui2ZvQC5Q5GXZt03Eji4j3owW
eKV1w0qSlUU09RgY7mvOWt7E66BqAZkNmgS5ItLxcJnXUmOxcPrMm09WTaTYwPKu
Rm/qZQceGtoyRUD2yqqSu04BPy4xFLgzQlG3cddnJJLiQ5pbnsTDbmuOfpBOxxHO
S9U08h8xjoYuh6l1AQfSU7O3joO4B33gcggTeoBOeopzNYgpzyx3PGbjlIbz5pma
CQjgYYc2uBcCOcmsZs2HRrKcUKX7+nEX+8W5ovWQmj9lAgMBAAE=
-----END PUBLIC KEY-----"
DEFAULT_LATEST="$RELEASES/latest.json"

info() { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
err()  { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
WARNINGS=0

MODE="production"; LAN=""; COMPANY=""; URL=""; APPS_URL=""; FRP=""; CN=""; DEMO=""; NO_OPENHEX=""
DEST=""; SRC=""; UPGRADE_URL="$DEFAULT_LATEST"; GIT=""; AUTOSTART="1"; YES=""; ALLOW_UNSIGNED=""
while [ $# -gt 0 ]; do
  case "$1" in
    --test) MODE="test"; shift;;
    --lan) LAN="1"; shift;;
    --company) COMPANY="${2:-}"; shift 2;;
    --url) URL="${2%/}"; shift 2;;
    --apps-url) APPS_URL="${2%/}"; shift 2;;
    --frp-server) FRP="${2:-}"; shift 2;;
    --cn) CN="1"; shift;;
    --demo) DEMO="1"; shift;;
    --no-openhex) NO_OPENHEX="1"; shift;;
    --dir) DEST="${2:-}"; shift 2;;
    --src) SRC="${2:-}"; shift 2;;
    --upgrade-url) UPGRADE_URL="${2:-}"; shift 2;;
    --offline) UPGRADE_URL=""; shift;;
    --git) GIT="1"; shift;;
    --no-autostart) AUTOSTART=""; shift;;
    --yes|-y) YES="1"; shift;;
    --allow-unsigned) ALLOW_UNSIGNED="1"; shift;;
    -h|--help) sed -n '2,31p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0;;
    *) err "未知参数 $1（./install.sh --help 看用法）";;
  esac
done

# ---------------------------------------------------------------- 参数检查
if [ "$MODE" = "production" ]; then
  [ -n "$URL" ] || err "正式安装要指定访问地址：--url https://one.example.com（本机试用：--test）"
  echo "$URL" | grep -qE '^https?://[^/]+$' || err "--url 要写成 https://域名（不带路径）：$URL"
  [ -n "$COMPANY" ] || err "正式安装要指定公司代号：--company acme（小写英文，用来标识这套平台）"
  echo "$COMPANY" | grep -qE '^[a-z][a-z0-9-]{1,39}$' || err "--company 要小写英文开头，只含小写字母、数字、短横线：$COMPANY"
  if [ -n "$APPS_URL" ]; then
    echo "$APPS_URL" | grep -qE '^https?://[^/]+$' || err "--apps-url 要写成 https://域名（不带路径）：$APPS_URL"
    [ "$APPS_URL" != "$URL" ] || err "--apps-url 不能和 --url 相同"
  fi
  [ -z "$FRP" ] || echo "$FRP" | grep -qE '^[A-Za-z0-9.-]+$' || err "--frp-server 写云服务器的公网 IP 或域名：$FRP"
fi
host_of() { echo "$1" | sed -E 's#^[a-z]+://##; s#[:/].*$##'; }

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "")"
IN_CHECKOUT=""
[ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/yh" ] && IN_CHECKOUT="1"

# 装到哪：试用和 --git 原地装；正式安装默认 ~/yihu-one
if [ -z "$DEST" ]; then
  if [ -n "$IN_CHECKOUT" ] && { [ "$MODE" = "test" ] || [ -n "$GIT" ]; }; then DEST="$SELF_DIR"
  elif [ -n "$IN_CHECKOUT" ] && [ ! -d "$SELF_DIR/.git" ]; then DEST="$SELF_DIR" # 已经是解压出来的更新包
  else DEST="$HOME/yihu-one"; fi
fi
case "$DEST" in /*) ;; *) DEST="$(pwd)/$DEST";; esac
if [ -n "$GIT" ]; then
  [ -n "$IN_CHECKOUT" ] && [ -d "$SELF_DIR/.git" ] || err "--git 要在 Git 检出的目录里执行"
  [ "$DEST" = "$SELF_DIR" ] || err "--git 是原地安装，不能和 --dir 一起用"
fi

# ---------------------------------------------------------------- 1. 检查这台机器
info "1/7 检查这台机器"
case "$(uname -s)" in
  Darwin) OS="macOS"; docker_how="brew install colima docker docker-compose && colima start --cpu 4 --memory 8 --disk 100"; pkg="brew install";;
  Linux)  OS="Linux"; docker_how="curl -fsSL https://get.docker.com | sh（国内加 -s -- --mirror Aliyun）"; pkg="apt install -y（或 yum install -y）";;
  *) err "不支持的系统（仅支持 macOS / Linux）";;
esac
for c in curl git jq openssl rsync tar; do command -v "$c" >/dev/null 2>&1 || err "缺少 $c：$pkg $c"; done
command -v docker >/dev/null 2>&1 || err "缺少 Docker：$docker_how"
docker info >/dev/null 2>&1 || err "Docker 没在运行（macOS：colima start；Linux：sudo systemctl start docker；当前用户没权限时：sudo usermod -aG docker \$USER 后重新登录）"
docker compose version >/dev/null 2>&1 || err "缺少 docker compose 插件（Linux：apt install docker-compose-plugin）"
ok "$OS，依赖齐全"

# Docker 能用的 CPU / 内存（macOS 上是 Colima 虚拟机的，不是整机的）
ncpu="$(docker info --format '{{.NCPU}}' 2>/dev/null || echo 0)"
mem_gb="$(docker info --format '{{.MemTotal}}' 2>/dev/null | awk '{printf "%.1f", $1/1073741824}')"
if awk -v m="${mem_gb:-0}" 'BEGIN{exit !(m < 3.5)}'; then
  err "Docker 只有 ${mem_gb}G 内存，至少要 4G（建议 8G）。macOS：colima stop && colima start --cpu 4 --memory 8 --disk 100"
elif awk -v m="${mem_gb:-0}" 'BEGIN{exit !(m < 7.5)}'; then
  warn "Docker 内存 ${mem_gb}G：平台能跑，应用多了会紧张（建议 8G 以上）"
else ok "Docker：${ncpu} 核 / ${mem_gb}G 内存"; fi
[ "${ncpu:-0}" -ge 2 ] 2>/dev/null || warn "Docker 只有 ${ncpu} 核，建议 4 核以上"
parent="$DEST"; while [ ! -d "$parent" ]; do parent="$(dirname "$parent")"; done
free_gb="$(df -Pk "$parent" | awk 'NR==2 {printf "%d", $4/1048576}')"
if [ "${free_gb:-0}" -lt 15 ]; then err "$parent 所在磁盘只剩 ${free_gb}G，至少要 15G（建议 50G 以上：镜像、数据库、备份）"
elif [ "${free_gb:-0}" -lt 40 ]; then warn "磁盘剩 ${free_gb}G，建议 50G 以上（备份每晚一份，保留 14 天）"
else ok "磁盘剩 ${free_gb}G"; fi

# 一台机器只跑一套平台（容器名 yh-*、开机自启的服务名都是固定的）
if [ ! -f "$DEST/yh.env" ] && docker ps -a --format '{{.Names}}' | grep -qE '^yh-(console|caddy|mysql)$'; then
  err "这台机器上已经有一套以虎 One 在跑（docker ps 能看到 yh-console 等容器），一台机器只能装一套。要重装先在原目录执行 ./yh destroy"
fi

# 网络：拉镜像、装 npm 包
reach() { curl -s -o /dev/null --max-time 8 -w '%{http_code}' "$1" 2>/dev/null | grep -qE '^[1-4][0-9][0-9]$'; }
if [ -z "$CN" ]; then
  if ! reach https://registry-1.docker.io/v2/ || ! reach https://registry.npmjs.org/; then
    warn "访问 Docker Hub 或 npm 官方源不通或很慢：国内网络加 --cn"
  else ok "能访问 Docker Hub、npm"; fi
else
  reach https://docker.m.daocloud.io/v2/ && reach https://registry.npmmirror.com/ && ok "能访问国内镜像（DaoCloud、npmmirror）" \
    || warn "国内镜像也访问不了：这台机器可能完全不能上网，需要先配代理或内网镜像（见部署手册「国内网络与内网」）"
fi

# 域名是否已经解析（隧道模式要解析到云服务器）
resolve() { { command -v dig >/dev/null 2>&1 && dig +short "$1" A | grep -E '^[0-9.]+$' | head -1; } || { command -v host >/dev/null 2>&1 && host -t A "$1" 2>/dev/null | awk '/has address/ {print $4; exit}'; } || true; }
if [ "$MODE" = "production" ]; then
  for h in "$(host_of "$URL")" ${APPS_URL:+"$(host_of "$APPS_URL")"}; do
    ip="$(resolve "$h")"
    if [ -z "$ip" ]; then warn "域名 $h 还没解析（或这台机器查不到），装完后对外访问前要先解析"
    elif [ -n "$FRP" ] && echo "$FRP" | grep -qE '^[0-9.]+$' && [ "$ip" != "$FRP" ]; then warn "域名 $h 解析到 $ip，不是云服务器 $FRP"
    else ok "域名 $h → $ip"; fi
  done
  [ -n "$APPS_URL" ] || warn "没配应用独立域名（--apps-url）：代码应用和控制台同源，应用页面里的脚本能读到用户的控制台登录凭证。生产强烈建议配"
fi

# ---------------------------------------------------------------- 确认
echo
echo "  安装到：$DEST"
if [ "$MODE" = "test" ]; then
  echo "  方式：  本机试用（测试模式：http、开发登录、不连隧道、不发通知）"
else
  echo "  公司：  $COMPANY"
  echo "  控制台：$URL"
  echo "  应用：  ${APPS_URL:-（和控制台同一个域名）}"
  echo "  入口：  $([ -n "$FRP" ] && echo "经云服务器 $FRP 的隧道" || echo "自己在前面配反向代理到本机 127.0.0.1:18080")"
  if [ -n "$GIT" ]; then up="Git 原地安装，自动跟踪 release 分支"
  elif [ -n "$UPGRADE_URL" ]; then up="更新包方式，从 $UPGRADE_URL 查新版本"
  else up="更新包方式，不联网查，拷更新包升级"; fi
  echo "  升级：  $up"
fi
echo "  镜像：  $([ -n "$CN" ] && echo 国内镜像 || echo 官方源)$([ -n "$DEMO" ] && echo '；装演示应用')"
if [ -z "$YES" ] && [ "$MODE" = "production" ]; then
  if [ -r /dev/tty ]; then
    printf '  确认安装？[y/N] '; read -r a < /dev/tty
    case "$a" in y|Y|yes) ;; *) err "已取消";; esac
  else err "没有终端可以确认：加 --yes"; fi
fi

# ---------------------------------------------------------------- 2. 取代码
info "2/7 准备平台文件"
fetch_package() { # fetch_package <包的本地路径或地址> [sha256] [签名 base64]
  local tmp sig="${3:-}"; tmp="$(mktemp -d)"
  case "$1" in
    http://*|https://*) curl -fSL --progress-bar "$1" -o "$tmp/pkg.tar.gz" || err "下载失败：$1"
      [ -n "$sig" ] || sig="$(curl -fsSL --max-time 20 "$1.sig" 2>/dev/null || true)";;
    *) [ -f "$1" ] || err "找不到更新包：$1"; cp "$1" "$tmp/pkg.tar.gz"
      [ -n "$sig" ] || sig="$(cat "$1.sig" 2>/dev/null || true)";;
  esac
  if [ -n "${2:-}" ]; then
    local got; got="$( (shasum -a 256 "$tmp/pkg.tar.gz" 2>/dev/null || sha256sum "$tmp/pkg.tar.gz") | awk '{print $1}')"
    [ "$got" = "$2" ] || err "更新包校验失败（sha256 不一致），重新下载试试"
  fi
  # 签名：用写死在本脚本里的发布方公钥校验（和 yh upgrade 同一套：openssl RSA-SHA256，签名是 base64）
  if [ -n "$sig" ]; then
    printf '%s\n' "$RELEASE_PUB" > "$tmp/release.pub"
    printf '%s' "$sig" | openssl base64 -d -A > "$tmp/pkg.sig" 2>/dev/null
    openssl dgst -sha256 -verify "$tmp/release.pub" -signature "$tmp/pkg.sig" "$tmp/pkg.tar.gz" >/dev/null 2>&1 \
      || err "更新包签名校验失败：包被改过，或者不是以虎发布的。从发布页重新下载"
    ok "签名校验通过"
  elif [ -n "$ALLOW_UNSIGNED" ]; then
    warn "更新包没有签名，按 --allow-unsigned 继续"
  else
    err "更新包没有签名（${1##*/}.sig），不能确认是以虎发布的。从发布页下载带签名的包；签名之前的老版本（如 0.1.0）加 --allow-unsigned"
  fi
  mkdir -p "$DEST"
  tar -xzf "$tmp/pkg.tar.gz" -C "$DEST" --strip-components=1 || err "解压失败"
  rm -rf "$tmp"
}
# 更新清单 → 下载包（清单里的 url 是相对地址时，相对清单所在目录）
fetch_from_manifest() {
  local j u
  j="$(curl -fsSL --max-time 20 "$1")" || return 1
  u="$(echo "$j" | jq -r '.url // empty')"; [ -n "$u" ] || err "更新清单里没有 url：$1"
  case "$u" in http://*|https://*) ;; *) u="${1%/*}/$u";; esac
  fetch_package "$u" "$(echo "$j" | jq -r '.sha256 // empty')" "$(echo "$j" | jq -r '.sig // empty')"
}
if [ -f "$DEST/yh" ]; then
  ok "使用已有的平台文件：$DEST（重复执行只补齐配置，不会动数据）"
elif [ -n "$SRC" ]; then
  case "$SRC" in
    *.json) fetch_from_manifest "$SRC" || err "取不到更新清单：$SRC";;
    *) fetch_package "$SRC";;
  esac
  ok "已解压到 $DEST"
elif [ -n "$IN_CHECKOUT" ] && [ -d "$SELF_DIR/.git" ]; then
  [ -z "$(git -C "$SELF_DIR" status --porcelain 2>/dev/null)" ] || warn "Git 检出里有没提交的改动：只会装已提交的版本（$(git -C "$SELF_DIR" rev-parse --short HEAD)）"
  mkdir -p "$DEST"
  git -C "$SELF_DIR" archive --format=tar HEAD | tar -xf - -C "$DEST" || err "导出失败"
  ok "已从 Git 检出导出 $(tr -d '[:space:]' < "$DEST/VERSION") 版到 $DEST（更新包方式，不跟踪分支）"
else
  info "  下载最新版本（$DEFAULT_LATEST）"
  fetch_from_manifest "$DEFAULT_LATEST" || err "取不到发布页的更新清单。拿到更新包后用 --src <包> 安装，或者 git clone 后在仓库里执行 ./install.sh"
  ok "已下载 $(tr -d '[:space:]' < "$DEST/VERSION") 版到 $DEST"
fi
[ -f "$DEST/yh" ] || err "$DEST 里没有 yh（包不对？）"
cd "$DEST" || err "进不去 $DEST"
VERSION="$(tr -d '[:space:]' < VERSION 2>/dev/null)"

# ---------------------------------------------------------------- 3. 写配置
info "3/7 写配置（yh.env）"
setkv() { # 只写这一行，保留其他内容和已生成的密钥
  touch yh.env; chmod 600 yh.env
  grep -vE "^$1=" yh.env > yh.env.tmp; mv yh.env.tmp yh.env
  printf '%s=%s\n' "$1" "$2" >> yh.env; chmod 600 yh.env
}
[ -f yh.env ] || { cp yh.env.example yh.env; chmod 600 yh.env; }
[ -n "$COMPANY" ] && setkv COMPANY "$COMPANY"
if [ -n "$CN" ]; then
  setkv IMAGE_MIRROR "docker.m.daocloud.io/"
  setkv NPM_REGISTRY "https://registry.npmmirror.com"
  setkv PRISMA_ENGINES_MIRROR "https://registry.npmmirror.com/-/binary/prisma"
fi
[ -n "$NO_OPENHEX" ] && setkv CONSOLE_OMIT_OPTIONAL 1
if [ "$MODE" = "production" ]; then
  setkv APPS_URL "$APPS_URL"
  [ -n "$FRP" ] && setkv FRP_SERVER_ADDR "$FRP"
  [ -d .git ] || setkv UPGRADE_URL "$UPGRADE_URL"
fi
ok "yh.env 就绪（权限 600，密钥在下一步生成）"

# ---------------------------------------------------------------- 4. 安装平台
info "4/7 安装平台（第一次要构建控制台镜像，约 3~10 分钟）"
if [ "$MODE" = "test" ]; then
  if [ -n "$LAN" ]; then ./yh init --test --lan || err "初始化失败，看上面的输出"
  else ./yh init --test || err "初始化失败，看上面的输出"; fi
else
  ./yh init --url "$URL" || err "初始化失败，看上面的输出（常见：拉镜像 / npm 超时 → 加 --cn 重试；可以直接重新执行本脚本）"
fi
envv() { grep -E "^$1=" yh.env | tail -1 | cut -d= -f2-; }

# ---------------------------------------------------------------- 5. 开机自启 + 常驻 agent
info "5/7 开机自启、常驻 agent、每晚备份"
AUTO_OK=""
if [ "$MODE" = "test" ]; then
  ok "测试模式跳过（试用时用不到；控制台里点「安装应用」要 agent：另开终端执行 ./yh agent）"
elif [ -z "$AUTOSTART" ]; then
  warn "按 --no-autostart 跳过：控制台里的安装 / 发布 / 停用操作会一直排队，之后执行 ./yh autostart"
elif [ "$OS" = "macOS" ]; then
  ./yh autostart && AUTO_OK=1 || warn "开机自启没装上，之后手动执行 ./yh autostart"
elif [ "$(id -u)" = "0" ]; then
  ./yh autostart && AUTO_OK=1 || warn "开机自启没装上，之后手动执行 ./yh autostart"
elif command -v sudo >/dev/null 2>&1; then
  sudo ./yh autostart && AUTO_OK=1 || warn "开机自启没装上，之后手动执行 sudo ./yh autostart"
else
  warn "Linux 装 systemd 服务要 root：之后执行 sudo ./yh autostart"
fi

# ---------------------------------------------------------------- 6. 演示应用
info "6/7 演示应用"
if [ -n "$DEMO" ]; then
  for d in "demo-node|node|演示 · Node 应用" "demo-py|python|演示 · Python 应用"; do
    code="${d%%|*}"; rest="${d#*|}"; tpl="${rest%%|*}"; name="${rest#*|}"
    if [ -d "apps/$code" ]; then ok "$code 已存在"; continue; fi
    if ( ./yh new "$code" --from "$tpl" --name "$name" >/dev/null && ./yh up "$code" ) > "backups/install-$code.log" 2>&1; then
      ok "$name：$(grep -oE 'https?://[^ ]+/apps/'"$code"'/' "backups/install-$code.log" | tail -1)"
    else warn "$name 没装上，日志 backups/install-$code.log"; fi
  done
else
  ok "跳过（想要的话：./yh new demo-node --from node --name 演示 && ./yh up demo-node）"
fi

# ---------------------------------------------------------------- 7. 自检 + 交付单
info "7/7 自检"
./yh doctor 2>&1 | grep -E '✓|✗' | sed 's/^/  /' || true
PUBLIC_URL="$(envv PUBLIC_URL)"
if [ "$MODE" = "production" ]; then
  SHEET="交付单-$COMPANY.md"
  case "$VERSION" in 0.*) CHANNEL="Beta";; *) CHANNEL="正式版";; esac
  CLOUD_CMD="DOMAIN=$(host_of "$URL")${APPS_URL:+ APPS_DOMAIN=$(host_of "$APPS_URL")} FRP_TOKEN=<yh.env 里的 FRP_TOKEN> INSTALL_DEPS=1 ./cloud/install.sh"
  cat > "$SHEET" <<SHEET
# 以虎 One 交付单 · $COMPANY

> 由 install.sh 在 $(date '+%Y-%m-%d %H:%M') 生成。逐项打勾，交付时连同下面的「交给客户」一起给对方。**本文件不含密钥**，密钥只在 \`$DEST/yh.env\`。

## 这套平台

| 项 | 值 |
| --- | --- |
| 公司 | $COMPANY |
| 版本 | $VERSION（$CHANNEL） |
| 平台机器 | $(hostname)（$OS），目录 \`$DEST\` |
| 控制台 | $URL |
| 应用域名 | ${APPS_URL:-未配置（生产建议配：yh.env 的 APPS_URL）} |
| 对外入口 | $([ -n "$FRP" ] && echo "云服务器 $FRP（frp 隧道）" || echo "前置反向代理 → 本机 127.0.0.1:18080") |
| 升级方式 | $([ -d .git ] && echo "Git 原地，自动跟踪 \`$(envv PLATFORM_BRANCH)\` 分支" || echo "更新包：控制台「管理 → 概览」点升级，或 \`./yh upgrade\` / \`./yh upgrade --package <包>\`") |
| 开机自启 / agent | $([ -n "$AUTO_OK" ] && echo 已安装 || echo "**未安装**：执行 \`$([ "$OS" = Linux ] && echo 'sudo ')./yh autostart\`") |

## 部署检查清单

- [ ] DNS：\`$(host_of "$URL")\`${APPS_URL:+、\`$(host_of "$APPS_URL")\`} 解析到 $([ -n "$FRP" ] && echo "云服务器 $FRP" || echo "前置反代")
$([ -n "$FRP" ] && printf '%s\n' "- [ ] 云服务器：安全组放行 TCP 7000、80、443；把本目录的 \`cloud/\` 拷过去执行 \`$CLOUD_CMD\`" "- [ ] 隧道：平台机器上 \`./yh doctor\` 的「隧道已连上云端」「公网访问」都通过")
- [ ] 打开 $URL 完成初始化向导（管理员账号、平台名称、组织名称）
- [ ] 管理 → 系统设置 → 外观与主题：选预设、按公司 VI 改颜色，上传公司 LOGO（基本信息）
- [ ] 管理 → 模型与 AI：加一个模型并「测试」通过
- [ ] 管理 → 登录方式：按需打开钉钉 / 飞书 / 企业微信（回调地址见部署手册 6.3）
- [ ] 管理 → 用户与部门：同步通讯录或手动加人，再设一个管理员
- [ ] 系统设置 → 发布通知：配群机器人并「发测试消息」
- [ ] 备份：yh.env 的 \`BACKUP_REMOTE\` 配异地备份；\`./yh backup\` 跑一次，确认 \`backups/\` 下有文件
- [ ] 按部署手册第 7 节验收；带客户体验一遍（第 8 节）：登录 → 工作台 → 演示应用统一登录 → AI 助手调用应用工具
- [ ] 把 \`yh.env\` 备份到公司的密码库（丢了数据库里加密保存的密钥就解不开）

## 交给客户

- 控制台地址、初始化时设置的管理员账号（密码由客户自己改）
- 平台机器位置、登录方式；目录 \`$DEST\`；**不要在这个目录里手改文件**（升级会覆盖）
- 日常：\`./yh status\` 看状态、\`./yh doctor\` 自检、\`./yh logs console\` 看日志；忘了管理员密码 \`./yh passwd admin\`
- 升级：控制台「管理 → 概览」有新版本时点「升级」（先自动备份，失败自动回滚）
- 文档：$URL/dev（开发中心，应用怎么接入）、部署手册 \`docs/部署手册.md\`
SHEET
  chmod 600 "$SHEET"
fi

echo
printf '\033[32m✅ 以虎 One %s 装好了%s\033[0m\n' "$VERSION" "$([ "$MODE" = test ] && echo '（本机试用）')"
echo "   控制台：$PUBLIC_URL"
if [ "$MODE" = "test" ]; then
  echo "   管理员：admin / $(envv ADMIN_INITIAL_PASSWORD)（登录页还有「开发登录」，可以直接选人）"
  echo "   接下来照 README「装好后体验」走一遍；用完 ./yh destroy 清掉"
else
  [ "$WARNINGS" -gt 0 ] && printf '\033[33m   上面有 %s 条提醒，交付前处理掉\033[0m\n' "$WARNINGS"
  if [ -n "$FRP" ]; then
    echo "   下一步：云服务器上执行（cloud/ 目录拷过去；令牌只在这里和 yh.env 里，别发群）："
    echo "     DOMAIN=$(host_of "$URL")${APPS_URL:+ APPS_DOMAIN=$(host_of "$APPS_URL")} FRP_TOKEN=$(envv FRP_TOKEN) INSTALL_DEPS=1 ./cloud/install.sh"
  else
    echo "   下一步：前置反代把 $URL${APPS_URL:+ 和 $APPS_URL} 转到本机 127.0.0.1:18080（保留 Host 和 X-Forwarded-* 头，关掉响应缓冲）"
  fi
  echo "   然后打开 $URL 完成初始化向导，再按交付单逐项打勾：$DEST/$SHEET"
fi
