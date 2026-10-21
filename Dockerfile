# syntax=docker/dockerfile:1

# lume-talentlens — Lume recruiting dashboard for GitHub footprints.
#
# Scratch 化：与 history/chinese/math 同款瘦身形态。
#   stage1  ui        : node:24-alpine 构建 React UI（产物 /src/www）
#   stage2  lume-build: debian 内静态链编译 fork 源码（含 agent-httpd 子模块的
#                      出站 HTTP builtins http_get/http_put/http_delete）——
#                      不再用 rust:1.85-slim（其价值只是自带 debian 构建链；
#                      显式静态链后运行时不再需要 libssl3/libsqlite3）
#   stage3  runtime   : lume:v0.6.3（scratch+busybox，历史/数学同款）——
#                      静态二进制 + www + app，USER 0（bind 卷 data/logs 宿主属主，
#                      不动用户目录属主；无 shell 的 scratch 下 root 风险可控）
#
# 注意：容器内 bash/curl/make 运维能力已随 scratch 化移除（docker compose exec
# app make fetch/people-scan 等不再可用），运维请改用宿主机 Makefile / 另行
# 保留的工具容器。构建上下文经 tar 打包（见 Makefile docker-build），只含
# frontend(无 node_modules)/scripts/app/Dockerfile，规避 buildkit 多 COPY
# 并发读同一 context 的 checksum 竞态。

# --- stage 1: build the React UI -------------------------------------------------
FROM node:24-alpine AS ui
RUN apk add --no-cache bash && npm i -g pnpm@12.5.1
WORKDIR /src
# install deps first (lockfile + pnpm policy file are all these need), then
# copy the rest so dependency layers stay cached across source edits
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./frontend/
# --ignore-scripts: pnpm 12 refuses to run esbuild's postinstall by default
# (ERR_PNPM_IGNORED_BUILDS); esbuild 0.24 ships its platform binary as an
# optional dependency, so skipping the postinstall is harmless and keeps the
# container build deterministic across pnpm versions.
RUN cd frontend && pnpm install --frozen-lockfile --ignore-scripts
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/
COPY www/ ./www/
RUN bash ./scripts/build-ui.sh

# --- stage 2: build the Lume binary (fork with outbound-HTTP builtins, static) ---
FROM debian:bookworm-slim AS lume-build
RUN apt-get update && apt-get install -y --no-install-recommends \
      git gcc libc6-dev libcrypt-dev libssl-dev zlib1g-dev libsqlite3-dev pkg-config ca-certificates make m4 \
    && rm -rf /var/lib/apt/lists/*
# the fork repo carries agent-httpd as a submodule — the HTTP builtins live
# there, so a plain shallow clone would produce a binary that dies with
# "undefined variable 'http_get'". `make` is the fork's build entry point
# (same as CI); it drops the binary at bin/lume.
# 静态链：-static + libssl.a/libcrypto.a/libz.a —— 出站 HTTPS 需要 TLS，
# 动态库不进运行时（与 medical-stats/history 同款 flags）。
ARG LUME_REPO=https://github.com/erishen/lume.git
RUN git clone --recurse-submodules --depth 1 "$LUME_REPO" /lume \
    && rm -rf /lume/lume-core/bin /lume/bin \
    && make -C /lume -j"$(nproc)" \
        CFLAGS_EXTRA="-D_GNU_SOURCE -DHAVE_CRYPT -DHAVE_CRYPT_H -ffunction-sections -fdata-sections -Wno-format-truncation -Wno-stringop-truncation" \
        LDFLAGS_EXTRA="-lcrypt -lm -lssl -lcrypto -lz -static -Wl,--gc-sections" \
    && strip /lume/bin/lume

# --- stage 3: runtime (scratch+busybox，lume:v0.6.3 基础镜像) --------------------
FROM lume:v0.6.3
USER 0
WORKDIR /app
COPY --from=lume-build /lume/bin/lume ./bin/lume
COPY app/ ./app/
COPY --from=ui /src/www/ ./www/
RUN mkdir -p /app/data /app/logs

# The server binds 0.0.0.0 inside the container; the compose file publishes
# it on the host loopback only, so exposure stays local (see README Security).
ENV LUME_GITHUB_BIND=0.0.0.0
EXPOSE 18091
# busybox nc 端口检查（scratch 无 curl；compose 原 curl healthcheck 已同步改）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD /bin/busybox nc -z 127.0.0.1 18091 || exit 1
# 清掉基础镜像的 entrypoint（其 auth 逻辑仅 history/medical-stats 需要）与
# 默认 CMD，直跑 lume（与原 debian 版行为一致）；配置由 compose env 注入。
ENTRYPOINT []
CMD ["./bin/lume", "app/github.lume"]
