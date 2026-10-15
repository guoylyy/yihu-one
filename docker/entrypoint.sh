#!/bin/bash
# 平台镜像的入口（docker/Dockerfile）。子命令：
#   install [install.sh 的参数…]   安装（默认）：第一次把平台文件放进平台目录，再执行 install.sh
#   agent                          常驻 agent（yh autostart 起的 yh-agent 容器用）
#   yh <子命令…>                   执行一条 yh 命令，如 yh destroy、yh autostart
set -uo pipefail
SRC=/usr/share/yihu-one

red() { printf '\033[31m%s\033[0m\n' "$*"; }
die() { red "✗ $*"; exit 1; }
EXAMPLE="docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock -v /opt/yihu-one:/opt/yihu-one <镜像>"

[ -S /var/run/docker.sock ] || die "没有挂宿主机的 Docker：加 -v /var/run/docker.sock:/var/run/docker.sock，如 $EXAMPLE"
docker info >/dev/null 2>&1 || die "连不上宿主机的 Docker（/var/run/docker.sock）：Docker 在运行吗？"
SELF="$(hostname)"
docker inspect "$SELF" >/dev/null 2>&1 || die "在宿主机的 Docker 里找不到当前容器（$SELF）：不要给容器加 --hostname"

# 平台目录：宿主机和容器里必须是同一个路径（-v /opt/yihu-one:/opt/yihu-one）——yh 生成的 compose 文件里的相对路径由宿主机的 Docker 解析。
# Docker Desktop 显示的来源路径可能带前缀（/host_mnt/Users/…），以挂载点结尾就算同一个
mounts="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}{{end}}' "$SELF")"
same_path() { case "$1" in "$2"|*"$2") return 0;; *) return 1;; esac; }
if [ -z "${YH_DIR:-}" ]; then
  YH_DIR="$(echo "$mounts" | while IFS='|' read -r s d; do
    [ -n "$d" ] && [ "$d" != /var/run/docker.sock ] && same_path "$s" "$d" && echo "$d"
  done)"
  [ -n "$YH_DIR" ] || die "没有挂平台目录：加 -v /opt/yihu-one:/opt/yihu-one（冒号两边写同一个路径；macOS 的 Docker Desktop 用家目录下的路径，如 -v \$HOME/yihu-one:\$HOME/yihu-one），如 $EXAMPLE"
  [ "$(echo "$YH_DIR" | wc -l)" -eq 1 ] || die "挂了好几个目录，用 -e YH_DIR=<平台目录> 指明是哪个：$(echo "$YH_DIR" | tr '\n' ' ')"
fi
YH_DIR="${YH_DIR%/}"
src="$(echo "$mounts" | awk -F'|' -v d="$YH_DIR" '$2 == d {print $1}')"
[ -n "$src" ] || die "平台目录 $YH_DIR 没有从宿主机挂进来：加 -v $YH_DIR:$YH_DIR"
same_path "$src" "$YH_DIR" || die "平台目录在宿主机和容器里要是同一个路径：现在是 ${src} → ${YH_DIR}，改成 -v $YH_DIR:$YH_DIR"

IMAGE="$(docker inspect -f '{{.Config.Image}}' "$SELF")"
export YH_DIR YH_SELF="$SELF"
# install.sh 打印「等价的命令」、交付单里的运维命令用
export YH_INSTALL_CMD="docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock -v $YH_DIR:$YH_DIR${TZ:+ -e TZ=$TZ} $IMAGE"

cmd="${1:-install}"; [ $# -gt 0 ] && shift
case "$cmd" in
  install)
    if [ ! -f "$YH_DIR/yh" ]; then
      [ -z "$(ls -A "$YH_DIR" 2>/dev/null)" ] || die "$YH_DIR 不是空目录，也没有装过平台：换一个空目录"
      cp -a "$SRC/." "$YH_DIR/" || die "放平台文件失败"
      printf '\033[32m  ✓ 已把平台 %s 版放到 %s\033[0m\n' "$(tr -d '[:space:]' < "$SRC/VERSION")" "$YH_DIR"
    fi
    exec /bin/bash "$YH_DIR/install.sh" "$@";;
  agent)
    [ -f "$YH_DIR/yh" ] || die "$YH_DIR 里没有平台文件，先安装"
    exec /bin/bash "$YH_DIR/yh" agent;;
  yh)
    [ -f "$YH_DIR/yh" ] || die "$YH_DIR 里没有平台文件，先安装"
    exec /bin/bash "$YH_DIR/yh" "$@";;
  *) exec "$cmd" "$@";;
esac
