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
# ---- stage 2: 取 lume 二进制 ----
# 从 release 下载, 不再 git clone + 源码重编。
# 原做法是 clone --depth 1 后 make, 问题是**不锁版本**: 每次构建拉到的是
# master 的最新 commit, 同一个 Dockerfile 在不同日子产出不同二进制 ——
# 出了问题无法复现, 也没法回答"线上跑的是哪版"。
# 改成按 tag 取静态包: 版本可查、sha256 可校验、构建更快(省掉编译)。
#
# 之前重编的理由(需要位运算 / for-in / 新内建)在 v0.12 系列都已发布。
# ARG 必须在 FROM **之后**重新声明才进得了 RUN 的作用域。
# 只在最顶层写一次的话, 第二个 FROM 起的 stage 里它是空的 ——
# 于是 URL 变成 .../download//lume-linux-... 报 404,
# 而报错只有一句 "curl: (22) ... 404", 看不出是变量没传进来。
FROM alpine:3.20 AS lume-fetch
ARG LUME_VERSION=v0.12.2
RUN apk add --no-cache curl tar ca-certificates \
 && case "$(uname -m)" in \
      x86_64) carch=x64 ;; \
      aarch64|arm64) carch=arm64 ;; \
      *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;; \
    esac \
 && base="https://github.com/erishen/lume/releases/download/${LUME_VERSION}" \
 && curl -fsSL --retry 3 --retry-delay 2 -o /tmp/l.tgz "${base}/lume-linux-${carch}-static.tar.gz" \
 && curl -fsSL --retry 3 -o /tmp/l.sha256 "${base}/lume-linux-${carch}-static.sha256" \
 && (cd /tmp && sed "s|lume-linux-${carch}-static.tar.gz|l.tgz|" l.sha256 | sha256sum -c -) \
 && mkdir -p /out && tar -xzf /tmp/l.tgz -C /out \
 && install -m 0755 "/out/lume-linux-${carch}-static/bin/lume" /out/lume \
 && /out/lume --version

# --- stage 3: runtime (scratch+busybox，lume:v0.6.3 基础镜像) --------------------
FROM lume:v0.6.3
USER 0
WORKDIR /app
COPY --from=lume-fetch /out/lume ./bin/lume
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
