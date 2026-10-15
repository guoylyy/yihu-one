# 以虎 One 平台镜像：只有 Docker 的机器（Windows / macOS 的 Docker Desktop、NAS、只给了 Docker 的服务器）用它安装和常驻运行
# 镜像里是一份完整的平台文件（和更新包一样）+ yh 要用的命令行工具，借宿主机的 Docker（挂 docker.sock）起平台和应用：
#
#   docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock -v /opt/yihu-one:/opt/yihu-one ghcr.io/guoylyy/yihu-one:<版本>
#
# 平台目录挂成宿主机和容器里同一个路径：yh 生成的 compose 文件里的相对路径（Caddyfile、应用的 ./data）由宿主机的 Docker 解析。
# 装完后常驻的 agent 也是这个镜像（容器 yh-agent），它替代 launchd / systemd：执行控制台里的操作、每晚备份。
# 构建：scripts/build-platform-image.sh（构建上下文是导出的平台文件，不是仓库目录）；发版由 .github/workflows/console-image.yml 推到 GHCR
ARG BASE_IMAGE=alpine:3.20
FROM ${BASE_IMAGE}
# yh / install.sh 的依赖（和宿主机安装时检查的一样）；GNU 版的 coreutils、grep、sed、findutils 免得 busybox 的行为差异
RUN apk add --no-cache bash coreutils findutils grep sed gawk curl jq git openssh-client openssl rsync tar gzip tzdata \
      docker-cli docker-cli-compose \
 && printf '#!/bin/bash\n[ -f "${YH_DIR:-}/yh" ] || { echo "没有平台目录（YH_DIR）"; exit 1; }\nexec /bin/bash "$YH_DIR/yh" "$@"\n' > /usr/local/bin/yh \
 && chmod +x /usr/local/bin/yh
COPY . /usr/share/yihu-one/
ARG VERSION=dev
LABEL org.opencontainers.image.title="yihu-one" org.opencontainers.image.version="$VERSION" org.opencontainers.image.source="https://github.com/guoylyy/yihu-one"
ENV YH_DOCKER=1
ENTRYPOINT ["/bin/bash", "/usr/share/yihu-one/docker/entrypoint.sh"]
CMD ["install"]
