# syntax=docker/dockerfile:1

# lume-talentlens — Lume recruiting dashboard for GitHub footprints.
#
# Three stages: (1) bundle the React UI with esbuild (pnpm), (2) build the
# Lume binary from the fork source (the released v0.6.1 binaries do NOT ship
# the outbound-HTTP builtins http_get/http_put/http_delete that the live
# fetch / people refresh / follow endpoints need), (3) run the server.
# Snapshots live under /app/data (mount a volume there — see docker-compose.yml).

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

# --- stage 2: build the Lume binary (fork with outbound-HTTP builtins) -----------
FROM rust:1.85-slim AS lume-build
RUN apt-get update && apt-get install -y --no-install-recommends \
      git libssl-dev libsqlite3-dev pkg-config ca-certificates make \
    && rm -rf /var/lib/apt/lists/*
# the fork repo carries agent-httpd as a submodule — the HTTP builtins live
# there, so a plain shallow clone would produce a binary that dies with
# "undefined variable 'http_get'". `make` is the fork's build entry point
# (same as CI); it drops the binary at bin/lume.
ARG LUME_REPO=https://github.com/erishen/lume.git
RUN git clone --recurse-submodules --depth 1 "$LUME_REPO" /lume \
    && make -C /lume

# --- stage 3: runtime -------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      libssl3 libsqlite3-0 ca-certificates curl bash make \
    && rm -rf /var/lib/apt/lists/*
COPY --from=lume-build /lume/bin/lume /usr/local/bin/lume

WORKDIR /app
COPY app/ ./app/
COPY scripts/ ./scripts/
COPY Makefile ./
COPY --from=ui /src/www/ ./www/
RUN mkdir -p /app/data /app/logs

# The server binds 0.0.0.0 inside the container; the compose file publishes
# it on the host loopback only, so exposure stays local (see README Security).
ENV LUME_GITHUB_BIND=0.0.0.0
EXPOSE 8091

# Configuration (OWNER / GH_TOKEN / LLM_* / …) is injected by compose via
# env_file. Snapshots come from data/ (mounted volume); fetch inside the
# container with: docker compose exec app make fetch
CMD ["/usr/local/bin/lume", "app/github.lume"]
