# 以虎 One 控制台：单容器镜像，前端构建产物由后端托管
# 由 yh 在 yh init / yh start 时构建（platform/compose.yml），一般不用手动 docker build
# 国内网络：yh.env 的 IMAGE_MIRROR / NPM_REGISTRY / PRISMA_ENGINES_MIRROR 经 compose 传进来（install.sh --cn 会填好），不填就走官方源
ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE} AS web
ARG NPM_REGISTRY=
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && npm ci --no-audit --no-fund
COPY frontend/ ./
COPY docs/devcenter /src/docs/devcenter
RUN npm run build

FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=
ARG PRISMA_ENGINES_MIRROR=
WORKDIR /app/backend
COPY backend/package*.json ./
# 要对外分发镜像时加 --build-arg OMIT_OPTIONAL=1：不装可选依赖（OpenHex SDK 的协议还没定，不能再分发）
ARG OMIT_OPTIONAL=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && npm ci --omit=dev $([ -n "$OMIT_OPTIONAL" ] && echo --omit=optional) --no-audit --no-fund
COPY backend/prisma ./prisma
RUN if [ -n "$PRISMA_ENGINES_MIRROR" ]; then export PRISMA_ENGINES_MIRROR; fi && npx prisma generate
COPY backend/src ./src
COPY --from=web /src/frontend/dist /app/frontend/dist
ENV NODE_ENV=production PORT=3105 STATIC_DIR=/app/frontend/dist
EXPOSE 3105
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3105/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
