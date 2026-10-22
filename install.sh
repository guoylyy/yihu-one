#!/bin/bash
# 以虎 One 安装脚本：给一家新公司从零装一套完整的平台（bash 3.2 兼容，macOS / Linux）。完整步骤见 docs/部署手册.md
#
#   本机试用（几分钟，http://localhost:18080，带开发登录）：
#     ./install.sh --test --demo
#
#   不知道怎么选：不带参数执行，一问一答（最后会给出等价的完整命令，下次可以直接用）：
#     ./install.sh
#
#   只在公司内网用（没有域名、不对外，员工用 http://<服务器 IP> 打开）：
#     ./install.sh --company acme --intranet --cn
#
#   给一家公司正式安装（推荐：平台机器在内网，公网云服务器只做 HTTPS + 隧道转发）：
#     ./install.sh --company acme --url https://one.example.com --apps-url https://apps.one.example.com \
#                  --frp-server 1.2.3.4 --cn --demo
#
#   只有 Docker 的机器（Windows / macOS 的 Docker Desktop、NAS）：用平台镜像装，参数一样（见 docs/部署手册.md「Docker 安装」）：
#     docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock -v /opt/yihu-one:/opt/yihu-one ghcr.io/guoylyy/yihu-one [参数…]
#
#   没有代码时一条命令安装（从发布页下载最新更新包）：
#     curl -fsSL https://github.com/guoylyy/yihu-one/releases/latest/download/install.sh | bash -s -- --company acme --url https://...
#
# 参数
#   --company <代号>      公司代号（小写英文，如 acme），写进 yh.env 和交付单
#   --url <访问地址>      控制台地址，如 https://one.example.com
#   --apps-url <地址>     应用独立域名，如 https://apps.one.example.com（生产强烈建议配：应用页面拿不到控制台登录凭证）
#   --frp-server <IP>     云服务器公网 IP：平台机器在内网、经隧道对外时填（不填 = 自己在前面配反代）
#   --intranet            内网模式：不对外、不配隧道，监听本机所有网卡，员工在内网用 http://<IP> 打开
#                         （钉钉 / 飞书 / 企业微信登录要从外网回调，内网模式下用账号密码登录）
#   --ip <内网 IP>        内网模式用哪个 IP（默认自动取）；有内网域名时改用 --url http://one.corp.example
#   --port <端口>         内网模式监听的端口（默认 80）
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
INTRANET=""; LAN_IP=""; PORT=""
# Docker 安装（docker/entrypoint.sh 调用）：平台目录是挂进来的 YH_DIR；常驻 agent 是容器；本机 IP、端口占用在容器里看不到
DOCKER="${YH_DOCKER:-}"
ME="${YH_INSTALL_CMD:-./install.sh}"                          # 「等价的命令」的开头
if [ -n "$DOCKER" ]; then YH="docker exec -it yh-agent yh"; YH_ONCE="$ME yh"; else YH="./yh"; YH_ONCE="./yh"; fi
ARGC=$#
while [ $# -gt 0 ]; do
  case "$1" in
    --test) MODE="test"; shift;;
    --lan) LAN="1"; shift;;
    --company) COMPANY="${2:-}"; shift 2;;
    --url) URL="${2%/}"; shift 2;;
    --apps-url) APPS_URL="${2%/}"; shift 2;;
    --frp-server) FRP="${2:-}"; shift 2;;
    --intranet) INTRANET="1"; shift;;
    --ip) LAN_IP="${2:-}"; shift 2;;
    --port) PORT="${2:-}"; shift 2;;
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
    -h|--help) sed -n '2,45p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0;;
    *) err "未知参数 $1（./install.sh --help 看用法）";;
  esac
done

# ---------------------------------------------------------------- 一问一答（不带参数、有终端时）
reach() { curl -s -o /dev/null --max-time 8 -w '%{http_code}' "$1" 2>/dev/null | grep -qE '^[1-4][0-9][0-9]$'; }
# 本机内网 IP：默认路由那块网卡的地址（Linux 上 hostname -I 第一个可能是 docker 网桥）
lan_ip() {
  local ifc ip=""
  case "$(uname -s)" in
    Darwin) ifc="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')"
      [ -n "$ifc" ] && ip="$(ipconfig getifaddr "$ifc" 2>/dev/null)"
      [ -n "$ip" ] || ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)";;
    *) ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}')"
      [ -n "$ip" ] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')";;
  esac
  echo "$ip"
}
# ask <提示> <默认值>：从终端读一行（curl | bash 时标准输入是脚本本身，所以读 /dev/tty）
ask() { local a; printf '  %s%s：' "$1" "${2:+（默认 $2）}" > /dev/tty; read -r a < /dev/tty; echo "${a:-$2}"; }
# choose <提示> <默认序号> <选项…>：打印编号选项，返回序号
choose() {
  local q="$1" def="$2" i=1 a; shift 2
  printf '\n  %s\n' "$q" > /dev/tty
  for o in "$@"; do printf '    %s) %s\n' "$i" "$o" > /dev/tty; i=$((i + 1)); done
  while :; do
    a="$(ask "选" "$def")"
    case "$a" in *[!0-9]*|'') ;; *) [ "$a" -ge 1 ] && [ "$a" -lt "$i" ] && { echo "$a"; return; };; esac
    printf '    输入 1~%s\n' "$((i - 1))" > /dev/tty
  done
}
yesno() { case "$(ask "$1 [y/n]" "$2")" in y|Y|yes|是) return 0;; *) return 1;; esac; }

if [ "$ARGC" -eq 0 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
  printf '\n\033[36m以虎 One 安装向导\033[0m：回答几个问题，回车用默认值\n' > /dev/tty
  if [ "$(choose "这次是？" 2 "在本机试用（几分钟，http://localhost:18080，用完删掉）" "给公司正式安装")" = 1 ]; then
    MODE="test"; DEMO="1"
  else
    while :; do
      COMPANY="$(ask "公司代号（小写英文，如 acme）" "")"
      echo "$COMPANY" | grep -qE '^[a-z][a-z0-9-]{1,39}$' && break
      printf '    小写英文开头，只含小写字母、数字、短横线\n' > /dev/tty
    done
    how="$(choose "员工怎么打开平台？" 1 \
      "只在公司内网用：没有域名，用 http://<这台机器的 IP> 打开（钉钉 / 飞书登录用不了，用账号密码）" \
      "有域名，经一台云服务器转发（这台机器在内网，云服务器做 HTTPS 和隧道）" \
      "有域名，公司自己的网关 / 反向代理转到这台机器")"
    if [ "$how" = 1 ]; then
      INTRANET="1"
      if [ -n "$DOCKER" ]; then
        while [ -z "$LAN_IP" ]; do LAN_IP="$(ask "这台机器的内网 IP（Docker 里看不到，要自己填，如 192.168.1.20）" "")"; done
      else LAN_IP="$(ask "这台机器的内网 IP" "$(lan_ip)")"; fi
      PORT="$(ask "端口" "80")"
    else
      while :; do
        URL="$(ask "平台地址（如 https://one.example.com）" "")"; URL="${URL%/}"
        echo "$URL" | grep -qE '^https?://[^/]+$' && break
        printf '    写成 https://域名，不带路径\n' > /dev/tty
      done
      d="$(echo "$URL" | sed -E 's#^[a-z]+://##; s#[:/].*$##')"
      if yesno "给应用单独一个域名吗？（推荐：应用页面拿不到控制台的登录凭证）如 apps.$d" "y"; then
        APPS_URL="$(ask "应用域名" "$(echo "$URL" | sed -E 's#^([a-z]+://).*#\1#')apps.$d")"; APPS_URL="${APPS_URL%/}"
      fi
      [ "$how" = 2 ] && FRP="$(ask "云服务器的公网 IP" "")"
    fi
    def_cn="n"; reach https://registry-1.docker.io/v2/ || def_cn="y"
    yesno "国内网络？（Docker 镜像、npm 走国内镜像）" "$def_cn" && CN="1"
    yesno "装两个演示应用？（体验统一登录、AI 工具用，以后可以删）" "n" && DEMO="1"
  fi
  cmd="$ME"
  if [ "$MODE" = "test" ]; then cmd="$cmd --test"
  else
    cmd="$cmd --company $COMPANY"
    if [ -n "$INTRANET" ]; then cmd="$cmd --intranet${LAN_IP:+ --ip $LAN_IP}"; [ "${PORT:-80}" = 80 ] || cmd="$cmd --port $PORT"
    else cmd="$cmd --url $URL${APPS_URL:+ --apps-url $APPS_URL}${FRP:+ --frp-server $FRP}"; fi
  fi
  [ -n "$CN" ] && cmd="$cmd --cn"; [ -n "$DEMO" ] && cmd="$cmd --demo"
  printf '\n  等价的命令（下次可以直接用）：\n    %s\n' "$cmd" > /dev/tty
fi

# ---------------------------------------------------------------- 参数检查
if [ "$MODE" = "production" ] && [ -n "$INTRANET" ]; then
  [ -z "$FRP" ] || err "--intranet 是只在内网用，不能和 --frp-server 一起用"
  [ -z "$PORT" ] || echo "$PORT" | grep -qE '^[0-9]{1,5}$' && [ "${PORT:-80}" -ge 1 ] && [ "${PORT:-80}" -le 65535 ] || err "--port 要写 1~65535 的端口：$PORT"
  if [ -z "$URL" ]; then
    [ -n "$LAN_IP" ] || [ -n "$DOCKER" ] || LAN_IP="$(lan_ip)"
    [ -n "$LAN_IP" ] || [ -z "$DOCKER" ] || err "Docker 里取不到宿主机的内网 IP：用 --ip <宿主机内网 IP> 指定"
    [ -n "$LAN_IP" ] || err "取不到这台机器的内网 IP，用 --ip 指定"
    echo "$LAN_IP" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || err "--ip 要写 IPv4 地址：$LAN_IP"
    PORT="${PORT:-80}"
    URL="http://$LAN_IP$([ "$PORT" = 80 ] || echo ":$PORT")"
  else
    # 内网域名：端口跟着地址走
    up="$(echo "$URL" | sed -nE 's#^[a-z]+://[^/:]+:([0-9]+)$#\1#p')"
    [ -z "$PORT" ] || [ -z "$up" ] || [ "$PORT" = "$up" ] || err "--port $PORT 和 --url 里的端口 $up 不一致"
    PORT="${up:-${PORT:-80}}"
  fi
fi
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
[ -z "$DOCKER" ] || [ -z "$LAN" ] || err "Docker 安装取不到宿主机的内网 IP，--test --lan 用不了：局域网要用的话正式安装 --company … --intranet --ip <宿主机内网 IP>"
[ -z "$DOCKER" ] || [ -z "$GIT" ] || err "Docker 安装不能用 --git（平台文件来自镜像）"

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "")"
IN_CHECKOUT=""
[ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/yh" ] && IN_CHECKOUT="1"

# 装到哪：试用和 --git 原地装；正式安装默认 ~/yihu-one；Docker 安装是挂进来的平台目录
if [ -n "$DOCKER" ]; then
  [ -z "$DEST" ] || [ "${DEST%/}" = "$YH_DIR" ] || err "Docker 安装的目录就是挂进来的 ${YH_DIR}，不用 --dir：换目录就改 -v 的路径"
  DEST="$YH_DIR"
elif [ -z "$DEST" ]; then
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
case "$([ -n "$DOCKER" ] && echo Docker || uname -s)" in
  Docker) OS="Docker"; docker_how="挂上宿主机的 docker.sock"; pkg="（镜像里应该都有，换个版本的镜像试试）";;
  Darwin) OS="macOS"; docker_how="brew install colima docker docker-compose && colima start --cpu 4 --memory 8 --disk 100"; pkg="brew install";;
  Linux)  OS="Linux"; docker_how="curl -fsSL https://get.docker.com | sh（国内加 -s -- --mirror Aliyun）"; pkg="apt install -y（或 yum install -y）";;
  *) err "不支持的系统（仅支持 macOS / Linux）";;
esac
for c in curl git jq openssl rsync tar; do command -v "$c" >/dev/null 2>&1 || err "缺少 ${c}：$pkg $c"; done
command -v docker >/dev/null 2>&1 || err "缺少 Docker：$docker_how"
docker info >/dev/null 2>&1 || err "Docker 没在运行（macOS：colima start；Linux：sudo systemctl start docker；当前用户没权限时：sudo usermod -aG docker \$USER 后重新登录）"
docker compose version >/dev/null 2>&1 || err "缺少 docker compose 插件（Linux：apt install docker-compose-plugin）"
if [ -n "$DOCKER" ]; then ok "Docker 安装（宿主机 $(docker info --format '{{.OperatingSystem}}' 2>/dev/null)），平台目录 $DEST"
else ok "${OS}，依赖齐全"; fi

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
  err "这台机器上已经有一套以虎 One 在跑（docker ps 能看到 yh-console 等容器），一台机器只能装一套。要重装先在原目录执行 $YH_ONCE destroy"
fi

# 网络：拉镜像、装 npm 包
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
port_busy() { # 有别的程序（不是我们自己的 Caddy）在监听这个端口
  { command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; } \
    || { command -v ss >/dev/null 2>&1 && ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"; }
}
if [ "$MODE" = "production" ] && [ -n "$INTRANET" ]; then
  if docker ps --format '{{.Names}}' | grep -q '^yh-caddy$'; then :
  elif [ -n "$DOCKER" ]; then ok "端口 ${PORT}（Docker 里看不到宿主机的端口占用：被占了的话启动时会报错，换 --port）"
  elif port_busy "$PORT"; then err "端口 $PORT 已经被别的程序占用，换一个：--port 8080"
  else ok "端口 $PORT 空闲"; fi
  if [ "$OS" = "Linux" ]; then
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then warn "防火墙 ufw 开着：放行端口 ${PORT}（sudo ufw allow $PORT/tcp），内网其他电脑才能打开"
    elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then warn "防火墙 firewalld 开着：放行端口 ${PORT}（sudo firewall-cmd --permanent --add-port=$PORT/tcp && sudo firewall-cmd --reload）"; fi
  fi
fi
if [ "$MODE" = "production" ]; then
  for h in "$(host_of "$URL")" ${APPS_URL:+"$(host_of "$APPS_URL")"}; do
    if echo "$h" | grep -qE '^[0-9.]+$'; then ok "用 IP 访问：$h"; continue; fi
    ip="$(resolve "$h")"
    if [ -z "$ip" ]; then warn "域名 $h 还没解析（或这台机器查不到），装完后对外访问前要先解析"
    elif [ -n "$FRP" ] && echo "$FRP" | grep -qE '^[0-9.]+$' && [ "$ip" != "$FRP" ]; then warn "域名 $h 解析到 ${ip}，不是云服务器 $FRP"
    else ok "域名 $h → $ip"; fi
  done
  [ -n "$APPS_URL" ] || warn "没配应用独立域名（--apps-url）：代码应用和控制台同源，应用页面里的脚本能读到用户的控制台登录凭证。生产强烈建议配"
fi

# ---------------------------------------------------------------- 确认
echo
echo "  安装到：$DEST"
if [ "$MODE" = "test" ]; then
  echo "  方式：  本机试用（测试模式：http、开发登录、不连隧道、不发通知）$([ -n "$DOCKER" ] && echo '，Docker 安装')"
else
  echo "  公司：  $COMPANY"
  echo "  控制台：$URL"
  echo "  应用：  ${APPS_URL:-（和控制台同一个域名）}"
  if [ -n "$INTRANET" ]; then echo "  入口：  只在内网用，本机监听 0.0.0.0:${PORT}（不对外、不配隧道；钉钉 / 飞书 / 企业微信登录用不了，用账号密码）"
  else echo "  入口：  $([ -n "$FRP" ] && echo "经云服务器 $FRP 的隧道" || echo "自己在前面配反向代理到本机 127.0.0.1:18080")"; fi
  [ -z "$DOCKER" ] || echo "  方式：  Docker 安装（常驻 agent 是容器 yh-agent）"
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
  ok "使用已有的平台文件：${DEST}（重复执行只补齐配置，不会动数据）"
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
  ok "已从 Git 检出导出 $(tr -d '[:space:]' < "$DEST/VERSION") 版到 ${DEST}（更新包方式，不跟踪分支）"
else
  info "  下载最新版本（${DEFAULT_LATEST}）"
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
  setkv CONSOLE_IMAGE_REPO "ghcr.m.daocloud.io/guoylyy/yihu-one-console"
fi
[ -n "$NO_OPENHEX" ] && setkv CONSOLE_OMIT_OPTIONAL 1
# Docker 安装：容器默认是 UTC，时区写进 yh.env（日志时间、每晚 02:30 备份按它）。docker run 带 -e TZ=… 时用它，国内网络默认上海
if [ -n "$DOCKER" ]; then
  tz="${TZ:-}"; [ -n "$tz" ] || [ -z "$CN" ] || tz="Asia/Shanghai"
  [ -n "$tz" ] && setkv TZ "$tz"
fi
if [ "$MODE" = "production" ]; then
  setkv APPS_URL "$APPS_URL"
  [ -n "$FRP" ] && setkv FRP_SERVER_ADDR "$FRP"
  if [ -n "$INTRANET" ]; then setkv LOCAL_HTTP_BIND "0.0.0.0"; setkv LOCAL_HTTP_PORT "$PORT"; fi
  [ -d .git ] || setkv UPGRADE_URL "$UPGRADE_URL"
fi
ok "yh.env 就绪（权限 600，密钥在下一步生成）"

# ---------------------------------------------------------------- 4. 安装平台
info "4/7 安装平台（下载控制台镜像约 1~2 分钟；拿不到时现场构建，约 3~10 分钟）"
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
if [ -n "$DOCKER" ] && [ -n "$AUTOSTART" ]; then
  # Docker 安装：试用也装上（agent 容器随 yh destroy 一起删掉，不留系统服务）
  ./yh autostart && AUTO_OK=1 || warn "常驻 agent 容器没起来，之后执行 $YH_ONCE autostart"
elif [ "$MODE" = "test" ]; then
  ok "测试模式跳过（试用时用不到；控制台里点「安装应用」要 agent：另开终端执行 ./yh agent）"
elif [ -z "$AUTOSTART" ]; then
  warn "按 --no-autostart 跳过：控制台里的安装 / 发布 / 停用操作会一直排队，之后执行 $YH_ONCE autostart"
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
      ok "${name}：$(grep -oE 'https?://[^ ]+/apps/'"$code"'/' "backups/install-$code.log" | tail -1)"
    else warn "$name 没装上，日志 backups/install-$code.log"; fi
  done
else
  ok "跳过（想要的话：$YH new demo-node --from node --name 演示 && $YH up demo-node）"
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
| 版本 | ${VERSION}（${CHANNEL}） |
| 平台机器 | $([ -n "$DOCKER" ] && echo "Docker 宿主机（$(docker info --format '{{.Name}}' 2>/dev/null)），平台目录 \`$DEST\`（宿主机上同一路径），镜像 \`${YH_INSTALL_CMD##* }\`" || echo "$(hostname)（${OS}），目录 \`$DEST\`") |
| 控制台 | $URL |
| 应用域名 | ${APPS_URL:-未配置（生产建议配：yh.env 的 APPS_URL）} |
| 对外入口 | $(if [ -n "$INTRANET" ]; then echo "只在内网用：本机 0.0.0.0:$PORT"; elif [ -n "$FRP" ]; then echo "云服务器 ${FRP}（frp 隧道）"; else echo "前置反向代理 → 本机 127.0.0.1:18080"; fi) |
| 升级方式 | $([ -d .git ] && echo "Git 原地，自动跟踪 \`$(envv PLATFORM_BRANCH)\` 分支" || echo "更新包：控制台「管理 → 概览」点升级，或 \`$YH upgrade\` / \`$YH upgrade --package <包>\`") |
| 开机自启 / agent | $([ -n "$AUTO_OK" ] && { [ -n "$DOCKER" ] && echo "已安装（容器 yh-agent）" || echo 已安装; } || echo "**未安装**：执行 \`$([ "$OS" = Linux ] && echo 'sudo ')$YH_ONCE autostart\`") |

## 部署检查清单

$(if [ -n "$INTRANET" ]; then echo "- [ ] 内网另一台电脑打开 $URL 能看到登录页（打不开：防火墙放行端口 ${PORT}）"; else echo "- [ ] DNS：\`$(host_of "$URL")\`${APPS_URL:+、\`$(host_of "$APPS_URL")\`} 解析到 $([ -n "$FRP" ] && echo "云服务器 $FRP" || echo "前置反代")"; fi)
$([ -n "$FRP" ] && printf '%s\n' "- [ ] 云服务器：安全组放行 TCP 7000、80、443；把本目录的 \`cloud/\` 拷过去执行 \`$CLOUD_CMD\`" "- [ ] 隧道：平台机器上 \`$YH doctor\` 的「隧道已连上云端」「公网访问」都通过")
- [ ] 打开 $URL 完成初始化（管理员账号、平台名称），登录后跟着**开通向导**走完：公司信息、外观、大模型（测试通过）、登录方式（测试连接通过）、人员、消息通知（「发一条给我」收到）、应用
- [ ] 开通向导最后一步「下载开通报告」，和本交付单一起留档
- [ ] 备份：yh.env 的 \`BACKUP_REMOTE\` 配异地备份；\`$YH backup\` 跑一次，确认 \`backups/\` 下有文件
- [ ] 按部署手册第 7 节验收；带客户体验一遍（第 8 节）：登录 → 工作台 → 演示应用统一登录 → AI 助手调用应用工具
- [ ] 把 \`yh.env\` 备份到公司的密码库（丢了数据库里加密保存的密钥就解不开）

## 交给客户

- 控制台地址、初始化时设置的管理员账号（密码由客户自己改）
- 平台机器位置、登录方式；目录 \`$DEST\`；**不要在这个目录里手改文件**（升级会覆盖）
- 日常：\`$YH status\` 看状态、\`$YH doctor\` 自检、\`$YH logs console\` 看日志；忘了管理员密码 \`$YH passwd admin\`
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
  echo "   接下来照 README「装好后体验」走一遍；用完 $YH_ONCE destroy 清掉"
else
  [ "$WARNINGS" -gt 0 ] && printf '\033[33m   上面有 %s 条提醒，交付前处理掉\033[0m\n' "$WARNINGS"
  if [ -n "$INTRANET" ]; then
    echo "   内网里的电脑都能打开 ${URL}（打不开先查防火墙是否放行端口 ${PORT}）"
  elif [ -n "$FRP" ]; then
    echo "   下一步：云服务器上执行（cloud/ 目录拷过去；令牌只在这里和 yh.env 里，别发群）："
    echo "     DOMAIN=$(host_of "$URL")${APPS_URL:+ APPS_DOMAIN=$(host_of "$APPS_URL")} FRP_TOKEN=$(envv FRP_TOKEN) INSTALL_DEPS=1 ./cloud/install.sh"
  else
    echo "   下一步：前置反代把 $URL${APPS_URL:+ 和 $APPS_URL} 转到本机 127.0.0.1:18080（保留 Host 和 X-Forwarded-* 头，关掉响应缓冲）"
  fi
  printf '\033[36m   打开 %s 继续开通\033[0m：浏览器里设管理员账号，然后开通向导一步步配外观、模型、登录方式、人员、应用\n' "$URL"
  echo "   交付单（逐项打勾）：$DEST/$SHEET"
  [ -z "$DOCKER" ] || echo "   运维命令都在 agent 容器里执行：$YH status、$YH doctor、$YH logs console"
fi
