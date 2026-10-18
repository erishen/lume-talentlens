# lume-talentlens

一个招聘视角的 GitHub 人才信号仪表盘：读取一个人的 GitHub 足迹，呈现**人才信号** —— 档案（求职中、社交链接）、工程严谨度、产出节奏、技术焦点、社区参与。基于 **Lume** 单二进制 C 框架（需带出站 HTTP 内建的构建，见[环境要求](#环境要求)）与 **React + TypeScript** 前端。

> Lume 提供 `.lume` DSL 来写路由 / SSR / 智能体工具，外加一个原生 HTTP 服务器（仅回环地址）与内置 LLM 聊天智能体。本项目把它接到 `github.com` 仓库的本地快照上，因此整个系统可以离线运行。

## 环境要求

- **带出站 HTTP 内建的 Lume build** —— 应用默认使用 release 二进制 `~/.local/bin/lume`（绝对路径；可用 `LUME=/path/to/lume` 覆盖）。它需要 `http_get` / `http_put` / `http_delete` 内建函数来支撑实时拉取代理（`/api/live/github`）、人脉刷新（`/api/refresh`）与关注/取关接口 —— `make dev` 会探测二进制能力，能力不足时拒绝启动。见下面的 **Lume 版本** 说明。
- **Node 22+ / pnpm** 用于前端（`(cd frontend && pnpm install)`）——vitest/jsdom 依赖链引入 undici 8，需要 Node 22+（CI 用 24）。
- 可选：`.env` 中的 `OWNER` / `GH_TOKEN` / `LLM_*`（见[配置（.env）](#配置env)）。

> **Lume 版本获取：** Lume 没有 `--version` 参数。release 二进制是对 `../lume`（与本仓库平级的 Lume fork）某次构建的产物。要确认当前版本：列出 fork 的 git tag（`git -C ../lume tag`，如 `v0.6.1`），或解析其当前 HEAD（`git -C ../lume describe --tags --always`）。当前安装的 `~/.local/bin/lume` 已含 fork 的代理失效直连回退（2026-10-08 替换；旧二进制保留在 `~/.local/bin/lume.bak-20261008`）。升级 Lume 后重新跑 `make check` + `make dev` —— 能力探测会校验二进制仍带 HTTP 内建。

## 项目结构

深入的分层、数据模型、数据流与关键机制见 [ARCHITECTURE.md](ARCHITECTURE.md)（中文架构文档）。

```
app/
  github.lume        # 入口：import 各 lib 模块、server{}、run()
  lib/analyze.lume   # 纯分析函数（直方图、排序、视图、bundle）
  lib/history.lume   # 每日时间线存储 —— 人脉/健康度历史（JSONL，每天一条）
  lib/shared.lume    # owner / 快照 / 字符串 helpers + gh_get（各模块共享）
  lib/api.lume       # JSON 接口：owners/overview/repos/…/people/refresh/people_diff/people_history/health_history
  lib/live.lume      # 实时 GitHub 代理（/api/live/github）+ 鉴权探针
  lib/ssr.lume       # SSR 页面（/overview、/repos、/api 参考）
  lib/tools.lume     # LLM 智能体工具（repo_* / github_*）
  lib/trending.lume  # GitHub 趋势项目（/api/trending，抓取页面 + 搜索回退）
  lib/classify.lume  # 归类总览（/api/classify —— 语言 + 主题聚合）
  lib/actions.lume   # /discovery + POST /api/follow + DELETE /api/unfollow
  lib/ui.lume        # SSR 页面组件（nav、kpi、bars、repo_row、page）
frontend/
  src/main.tsx       # React 入口 —— Dashboard（默认）或 Agent（data-page=chat）
  src/Dashboard.tsx  # 标签页：概览（KPI/柱状图/Top-10/对比）、仓库、人脉、趋势、归类
  src/Agent.tsx      # 服务端原生 /react/api/chat 的 SSE 聊天客户端
  src/api.ts, types.ts, tsconfig.json, package.json
www/github/
  index.html         # "/" 处的 SPA 外壳（React 仪表盘） <- 经 views 目录提供
  chat.html          # /chat 智能体外壳
  app.css            # 共享深色样式表（SSR + React）
  app.js             # React 打包产物（构建输出）
data/github/         # scripts/fetch-github.sh 生成的快照
scripts/
  fetch-github.sh    # 分页拉取 /users/<owner>/repos，预计算派生字段
  build-ui.sh        # pnpm 管理依赖 + 运行 esbuild
Makefile             # check / fetch / ui / dev
```

## 快速开始

```bash
(cd frontend && pnpm install) # 前端依赖（react、esbuild、typescript）—— 仅首次克隆
make dev          # 杀掉占用端口的老服务 + 构建 UI + esbuild watch +
                  # 前台运行 :8091（Ctrl-C 同时停掉服务与 watcher）
# 或分步执行：
make fetch        # 快照你的仓库 -> data/github/
make ui           # esbuild React 打包 -> www/github/app.js
make check        # 类型检查 .lume 文件 + 运行时 sanity（sanity.lume）
make test         # 前端单测（vitest —— 人才推导、i18n 键一致性、CSV 转义）
make classify     # 打印 owner 的仓库归类总览（需 :8091 上有服务运行）
make daily        # 每日自动雷达 + 变更摘要 -> logs/daily/<date>.md
make trending-push # 把 GitHub 趋势榜推到群机器人（钉钉/企微/Server酱）
make archive      # 把雷达池导出为 markdown 知识库（供 HR/学习）
make dev PORT=9000
```

服务始终运行在**前台** —— 没有后台版 `make run`；`make dev` 是唯一的开发循环，启动前会先杀掉占用该端口的旧服务。

打开 <http://127.0.0.1:8091/> 看 React 仪表盘，`/chat` 是智能体，其余见下方路由表。

## Docker 部署

附带容器化部署：镜像会用 esbuild 打包 React UI、从 fork 源码**编译 Lume 二进制**（发布版二进制缺 `http_get`/`http_put`/`http_delete` 出站 HTTP 内建，实时拉取/刷新/关注接口依赖它们），并发布在宿主机的 :18091 端口。

```bash
docker compose up -d --build   # 首次构建要编译 Rust，耗时较长
open http://127.0.0.1:18091
```

- **配置**：来自 `.env`（与 `make dev` 同一文件），由 compose 注入；`OWNER` / `GH_TOKEN` / `LLM_*` 用法不变。
- **数据持久化**：`./data` 挂载进容器（快照 + 实时缓存磁盘层，重建不丢）。
- **仅回环**：端口发布为 `127.0.0.1:18091:18091`（宿主机 18091 → 容器 18091），容器对外不可达（与原生安装一致的暴露姿态，见[安全与隐私](#安全与隐私)）。bridge 网络要求应用**在容器内**绑定 `0.0.0.0`（compose 已设置 `LUME_GITHUB_BIND`）；只有宿主机侧的映射是回环地址。
- **容器内抓快照**：`docker compose exec app make fetch`（或 `OWNER=foo docker compose exec app make fetch`）。
- **宿主服务互通**：容器跑在 bridge 网络上，容器内的 `127.0.0.1` 指向容器自身 —— compose 会把代理与 LLM 端点改写为 `host.docker.internal`（如 `LUME_HTTP_PROXY=http://host.docker.internal:7897`、`LLM_API_URL=http://host.docker.internal:19070/v1/chat/completions`），OrbStack 会把它转发到宿主回环。只有当宿主服务监听在别处时，才需要在 `.env` 里设置 `LUME_HTTP_PROXY_HOST` / `LLM_API_URL_HOST` 覆盖。
- **git / crates 下载慢或失败**（大陆 TLS 重置）：用代理作为构建参数重编：`docker compose build --build-arg HTTP_PROXY=http://host.docker.internal:7897 --build-arg HTTPS_PROXY=http://host.docker.internal:7897`。

## 配置（.env）

把 `.env.example` 复制为 `.env` 并填入自己的值 —— 该文件被 gitignore，因此**公开克隆不携带任何个人数据**（`data/github/` 下的快照同样被 gitignore，代码里也没有硬编码任何 owner）：

```bash
cp .env.example .env   # 然后编辑 OWNER=你的 GitHub 登录名
```

| 键 | 用途 |
|---|---|
| `OWNER` | 你的 GitHub 登录名。默认 owner（直到 `data/github/last_owner` 存在），也是**唯一**会对其粉丝/关注列表合并水号/招聘方预筛查（`suspects.json`）到 `/api/people` 的 owner。 |
| `GH_TOKEN` | 可选 classic PAT（scope `user:follow`）：实时代理（`/api/live/github`）、人脉刷新（`/api/refresh`）、`fetch-github.sh`、`people-scan.sh`、`unfollow.sh` 的配额从 60 提到 5000 次/时。切勿提交真实 token。 |
| `LUME_GITHUB_PORT` | 可选端口覆盖（默认 8091）。 |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` | 可选，给 `/chat` 智能体与智能体工具：把 Lume 内置 LLM 桥接到任意 OpenAI 兼容端点（如 `https://api.openai.com/v1` + `gpt-4o-mini`）。不设置则用内置的离线兜底引擎。 |
| `LLM_TIMEOUT` | 可选；等待上游 LLM 流的秒数（默认 60）。 |
| `LLM_SYSTEM_EXTRA` | 可选原始文本，**追加到智能体系统提示词末尾** —— 智能体必须始终遵守的场景指令（从哪些数据作答、如何引用证据、输出语言）。仅单行（.env 加载器逐行读取）。 |
| `AGENTHTTPD_CSP_IMG_SRC` | 可选空格分隔的源，**追加到服务器 `Content-Security-Policy` 的 `img-src`**（默认策略 `'self' data:`）。UI 需要加载第三方图片时使用 —— 本项目用它放行 GitHub 头像 CDN：`AGENTHTTPD_CSP_IMG_SRC=https://avatars.githubusercontent.com`。 |
| `LIVE_CACHE_TTL_SEC` | 可选 `/api/live/github` 内存响应缓存 TTL 秒数（默认 300；`0` 关闭）。重复浏览同一档案时从缓存返回，省 GitHub 配额与延迟。成功响应还会持久化到 `data/github/live/`（磁盘层，`LIVE_DISK_TTL_SEC` 默认 24h），智能体工具与各浏览器在重启后仍可复用。 |

以上每个键都会在 `make dev` 启动时由 **Makefile 导出给应用/服务进程**（`-include .env` 旁有 `export …`）—— 服务器自身也有一个懒加载的 .env 读取器，但显式导出才是可靠路径。shell/python 脚本同样会 source `.env`。其中任何一个也可以用普通环境变量传入（如 `OWNER=acme make fetch`），后者永远优先。

> 服务器只绑定 `127.0.0.1`。智能体与仪表盘针对**本地快照**分析已缓存的 owner；未缓存的 owner 通过服务器的 `/api/live/github` 路由按需拉取 —— 该路由用 Lume 内建 `http_get()` 从宿主机调用 GitHub REST API（经 libssl 出站 TLS），并**把响应投影为应用消费的字段**（原始 100 仓库页约 250KB，会撑破框架的响应上限）。设置 `GH_TOKEN` 拿到 5000 次/时的鉴权配额；不设置时共享服务器 IP 匿名限 ~60 次/时。设置 `LLM_*`（见配置表）启用真实模型聊天；否则由离线兜底引擎应答。写操作（`/api/follow`、`/api/unfollow`）**只接受 `Content-Type: application/json`**（CSRF 防护：跨站 JSON fetch 被浏览器 preflight 阻断——服务器不发 CORS 头；HTML form / text-plain 载体在解析 body 前被 403 拒绝）。

> **两层视图。** SSR 页面（`/overview`、`/repos`、`/api`）是同一快照的只读、零依赖视图。`/` 的 React 仪表盘才是完整交互产品：人才信号、综合健康分、可复制的 HR 备注、并排对比、push 活跃趋势、以及未缓存 owner 的服务端实时数据。HR / 招聘方要落地使用，优先 React 仪表盘。
>
> `make dev` 是唯一的开发循环（Ctrl-C 同时停服务与 watcher）；启动前会杀掉端口上的旧服务、清理过期智能体会话记录（`.data/sessions`，保留最新 30 份）、轮转 `logs/access.log`。

## 安全与隐私

- **仅本机回环。** 服务器只绑定 `127.0.0.1`，不监听任何网络接口。**不要把它隧道/端口转发到公网**：`/api/follow`、`/api/unfollow` 会用你的 token 操作**你的 GitHub 账号**，仪表盘展示的是你的个人网络画像。
- **写操作有 CSRF 防护。** 关注/取关/刷新只接受 `Content-Type: application/json`（HTML 表单与 text/plain 请求一律 403），且服务器不发 CORS 头——跨站 JSON 请求会被浏览器 preflight 阻断。该 Lume 版本不暴露请求头，无法再加 Origin/Referer 白名单，请务必保持仅回环。
- **密钥永不离开 `.env`。** `GH_TOKEN` / `LLM_API_KEY` 通过 `env()` 读取（任何含 TOKEN/API_KEY/SECRET/PASSWORD 的变量名都会被掩码），从不写日志；`.env` 与 `data/github/`（快照、评分、水号嫌疑）均已 gitignore——公开克隆不带任何凭据或个人快照数据。
- **令牌最小权限。** 读取类功能（快照、趋势、live 代理）用**不带任何 scope** 的 classic token 即可（仍享 5000 次/时），或用仅限公开仓库（只读）的 fine-grained token。只有关注/取关需要 `user:follow`，建议单独签发一个 token（或不启用该功能），不要把它加在读取用的 token 上。
- **本机 PII 驻留。** `data/github/` 快照与 `.data/sessions/` 聊天记录是明文，虽已 gitignore 但不会自动过期。`make purge` 清理超过 `SESSIONS_TTL_DAYS`（默认 30）天的会话，`make purge-owner OWNER=x` 删除某个 owner 的快照。
- **LLM 智能体数据。** 配置 `LLM_*` 后与智能体对话时，相关快照数据（仓库列表、画像、雷达/人脉摘要）会发送给你配置的 LLM 提供商。不配置 `LLM_*` 则使用离线兜底引擎，不会发起任何出站调用。

## 路由

| 方法 | 路径 | 说明 |
| ------ | ---- | ----- |
| GET | `/` | React SPA 仪表盘（静态，`views` 目录） |
| GET | `/overview` | SSR 概览（KPI + 柱状图 + Top-10） |
| GET | `/repos` | SSR 完整仓库列表 |
| GET | `/api` | SSR API 参考页 |
| GET | `/chat` | React 智能体聊天外壳 |
| GET | `/api/overview` | 聚合 + 人才信号 + push_trend |
| GET | `/api/repos?offset=&limit=` | 分页归一化仓库（单页上限 50） |
| GET | `/api/owners` | 本地已缓存 owner + 当前默认 |
| GET | `/api/people?owner=x` | 粉丝 / 关注（首页，各至多 100）+ 合并水号/招聘方预筛查 + 影响力评分 |
| GET | `/api/top` | 按 stars + 按活跃度 Top-10 |
| GET | `/api/langs` `/api/recency` `/api/year` | 单项直方图 |
| GET | `/api/search?q=rust` | 名称/描述/语言/主题的子串匹配 —— 返回 `{ owner, q, total, shown }`（shown ≤ 10） |
| GET | `/api/radar` | 高手雷达原样返回 —— 未跑 `make radar` 时为 `{status:404,…}` |
| GET | `/api/people_diff` | 自上次刷新以来谁新关注 / 取关了（首次刷新 `has_history: false`） |
| GET | `/api/people_history?owner=x&days=90` | 每日粉丝/关注时间线 —— `{ ok, owner, days, points:[{ date, ts, followers, following, added_followers, gone_followers, added_following, gone_following }] }`。每天一条记录（按日期 upsert，由 `make fetch` / `/api/refresh` 写入）；added_*/gone_* 为当日相对前一日的差分，可回答"上周谁新关注了我"。`days` 限制窗口（默认 90，上限 365） |
| GET | `/api/health_history?owner=x&days=90` | 每日开源健康分 —— `{ ok, owner, days, points:[{ date, ts, total, pillars:{ activity, rigor, focus, influence } }] }`。由 `/api/overview` 记录（与仪表盘展示的分数同源）；pillars 以 0..1 存储，前端可按当前权重重新计分 |
| GET | `/api/refresh` | 服务端重新拉取粉丝/关注 + 档案总数，重写 `people.json`（限流，每 owner 60 秒） |
| GET | `/api/live/github?path=/users/<x>` | 服务端 GitHub 代理（出站 `http_get`）；返回 `{ ok, status, data, err }` —— 大载荷先投影再返回 |
| GET | `/api/github_auth` | `{ authed: bool }` —— live 调用是否带 `GH_TOKEN`（5000 次/时）；绝不泄露 token |
| GET | `/api/classify?owner=<login>&since=daily\|weekly\|monthly\|quarterly\|year&pages=1` | 归类总览 —— 把该 owner 在窗口内新建的**公开**仓库，按 GitHub 的语言识别（Linguist）与已应用主题聚合；返回 `{ ok, owner, since, days, generated_at, count, total, languages, topics, repos, truncated }`，带 TTL 缓存（默认 `quarterly`=90 天，`pages` 默认 1、上限 3）。查询恒带 `is:public` 并丢弃私有条目兜底。驱动仪表盘"归类"页与 `make classify` |
| GET | `/api/trending?since=daily\|weekly\|monthly&lang=go&tr=zh&owner=<login>` | GitHub 趋势项目 —— 全局榜**直接抓取 github.com/trending 页面**（列表、顺序、星数与该页一致）；返回 `{ ok, scope, owner, since, days, generated_at, source, count, items }`，TTL 缓存（内存 `TRENDING_CACHE_TTL_SEC` 默认 120 / 磁盘 `TRENDING_DISK_TTL_SEC` 默认 600），`refresh=1`（前端刷新按钮、`make trending-push`）跳过两层缓存取最新。`source` 为 `github-trending` 或 `github-search`。页面无 API 也无 owner 维度，故 `owner=<login>`（该账号自己窗口内新建的公开仓库，`user:<login> created:>window is:public`，`scope:"owner"`）与无 slug 的语言（C++、C#）回退到 **搜索 API**（窗口内新建、按 Star 排序）；搜索恒带 `is:public`（该调用使用服务端 token，否则可能看到 token 所有者的私有仓库），并额外丢弃私有条目兜底。`tr=zh` 时经 LLM 网关机翻描述为中文（`desc_zh`；尽力而为、按描述记忆化、失败回退英文） |
| GET | `/discovery` | 启动期工具/技能/MCP 目录 |
| POST | `/api/follow` | 用 PAT 关注某人 —— body `{ "login": … }`（幂等，204；需要 `user:follow`） |
| DELETE | `/api/unfollow` | 用 PAT 取关某人 —— body `{ "login": … }`（幂等，204；需要 `user:follow`） |

> 框架对单个响应体有上限，因此 `/api/overview` 只给聚合，完整仓库列表经 `/api/repos` 分页，live 代理也会把原始 GitHub JSON 投影到应用消费的字段。

## 智能体工具

`repo_insights`、`repo_search`、`repo_language`、`repo_recency`、`repo_year`、`repo_stats` —— 都读内存快照并返回紧凑 JSON。`github_story` 把同一份数据组织成面试自我介绍 / 项目故事素材。人脉侧工具：`github_owners`（已缓存 owner + 默认）、`github_radar`（互相关注高分者按盈利模式分组 —— startup / crypto / company / content / tools / hunting / other，附一行证据）、`github_people`（粉丝/关注首页 + 总数 + 合并的水号嫌疑标记 + 互相关注重叠）。问智能体"我人脉里谁是真正的高手 / 他们怎么赚钱 / 哪些是水号"，它会用本地数据 + radar/people 工具作答。`radar_insights` 按关键词与分数过滤雷达池（`query` 空格分词的词必须都出现在该人的 bio/证据 note/公司/模式/重点仓库名+描述中；`min_score` 抬高分数门槛），返回命中者的证据摘要——问"我这些互相关注高分者里谁在做 AI 工具"，它会引用真实仓库名与 star 数作答。

## 数据管道

`scripts/fetch-github.sh`（Python，除 `curl` 外无外部依赖）分页拉取 `/users/<owner>/repos`，然后**预计算**应用消费的派生字段：`created_year`、`age_days`、`days_since_push`、`days_since_updated`、`recency`（active ≤90d / recent ≤365d / dormant ≤2y / stale —— 按**距上次 push 的天数**分桶，不是 updated_at）、裁剪后的 `description`、限长的 `topics`、以及 `push_month`（YYYY-MM，驱动"近期活跃"趋势）。快照被投影到约 24 个字段/仓库，JSON 保持小巧。快照位于 `data/github/<owner>/`，任意数量的 owner 可以共存；最近一次拉取被记录在 `data/github/last_owner`，并（在 `OWNER` 环境/.env 之后）作为全局默认 owner。

## 选择分析对象

仪表盘有 **owner 输入框**（带已缓存 owner 的 datalist）。两种方式分析一个 GitHub 账号：

1. **实时（任意 owner，无需预拉取）** —— 输入用户名，若未缓存，仪表盘给出 **Fetch live from GitHub**。浏览器调用同源 `/api/live/github` 路由，该路由*从服务器*经 Lume 内建 `http_get()` 代理 GitHub REST API（出站 TLS）。这绕开了浏览器对 `api.github.com` 的 CORS / 出口问题 —— 页面永远只和自己主机通信。未鉴权时共享约 60 次/时；设置 `GH_TOKEN` 可提升配额。
2. **缓存 / 离线** —— 先 `OWNER=acme make fetch` 一次；该 owner 就会出现在**已缓存**列表中，此后所有路由与智能体工具都从 `data/github/acme/` 离线服务。

配套机制：
- **API**：任意路由后加 `?owner=<login>`（如 `/api/overview?owner=torvalds`）；不带参数则用默认（最近拉取）owner。
- **缺快照**：JSON 路由返回 200 响应体 `{"status":404,"error":"no_snapshot","owner":…,"hint":"…"}`；UI 把它渲染成上面的二选一面板。
- **智能体工具**：所有 `repo_*` 工具接受可选 `owner` 参数；`github_owners` 列出本地已缓存 owner。

## 水号 / 招聘方预筛查

`scripts/people-suspects.py` 只用本地数据（头像 uid 的账号年龄代理 + 登录名模式），在 owner 的**粉丝与关注**里标记疑似批量注册的水号（僵尸号/批量关注）—— **不消耗 GitHub API**。它写出 `data/github/<owner>/suspects.json`，服务器按 login 把该预筛查合并进 `/api/people`，仪表盘于是在两个列表上显示 `水号 / maybe 水号 / 招聘方` 徽标：

```bash
make suspects                  # 默认 owner，两个列表（KIND=all）
KIND=following make suspects   # 只跑一个列表
```

判定阈值已可配置（无需改代码即可调整口径）—— `SUSPECT_MODE=standard|strict|lenient` 选择预设（默认 `standard` 完全复刻历史行为；`strict` 更激进：最近注册=约 2022+、注册年份新即可判 high；`lenient` 更克制、置信度更高：最近注册须 2025+ **且**带登录名模式、high 需 2026+ 且 ≥2 个模式）。还可逐个旋钮覆盖预设：`SUSPECT_RECENT_BOUND`、`SUSPECT_HIGH_BOUND`、`SUSPECT_HIGH_NEEDS_PATTERN`、`SUSPECT_PATTERN_MIN`、`SUSPECT_RECENT_NEEDS_PATTERN`、`SUSPECT_USE_UID`（0 = 关掉头像 uid 年龄信号，退化为纯模式检测）、`SUSPECT_BUZZWORDS` / `SUSPECT_BATCH_NAMES`（逗号列表，**替换**默认词汇表）。每个默认值都由 `scripts/suspects-selftest.py` 锁定（纳入 `make test`）。

`scripts/unfollow.sh` 是**数据驱动**的 —— 它读取 `suspects.json` 里的 `kind=following` 嫌疑人（默认等级 `high`；`--level medium` / `--also "login …"` 可扩大范围），用 `user:follow` PAT 批量取关。可先不带 token 试跑：

```bash
bash scripts/unfollow.sh --dry-run   # 只打印候选列表，不改变任何东西
GH_TOKEN=ghp_xxx bash scripts/unfollow.sh
```

逐账号的精确确认（粉丝数 / 仓库数 / 账号年龄）需要 GitHub API —— 见 `scripts/people-scan.sh --help`。

## 高手雷达、评分与值得关注

`scripts/people-score.sh` 用影响力评分给每个粉丝/关注排名（`min(40, repos/2) + min(20, followers/50) + min(15, 粉丝/关注比·5) + min(10, 年限) + 5·hireable + 3·bio`，水号在合并时 −20/−10），写入 `scores.json`（gitignored）。粉丝数刻意降权（虚高粉丝是营销号典型特征），改用**粉丝/关注比**校准；水号扣分使其无法靠灌粉买到排名。仪表盘按评分排序并给高分打 `高分` 徽标；同时计算**互相关注**与**值得关注**（你还没关注的粉丝里的高分者）列表，并在每次刷新后展示人脉变动 diff：

```bash
make score                 # 重新排名所有人（默认 owner）
```

`scripts/follow-worthy.sh` 把还没关注的高分粉丝回关（幂等，需要 `user:follow` PAT）：

```bash
DRY_RUN=1 make follow-worthy        # 只列清单
make follow-worthy                  # 执行关注
```

`scripts/radar-scan.sh`（make radar）扫描你的**互相关注高分者**（people-score ≥ 60），再用**以 star 质量为主**的评分重排（`min(40, star总数/10) + min(25, star/仓库·5) + 活跃度(近90天 20 / 近1年 10) + 降权的粉丝/年限 + hireable/bio − 水号扣分`，上限约 123），并按盈利模式分类 —— startup / crypto / company / content / tools / hunting / other，从实时档案 + 完整仓库列表写入 `data/github/<owner>/radar.json`。仪表盘的**高手洞察 · 盈利模式**面板按模式分组展示，点击任意人像卡片可在应用内分析：

每个人还带**变现信号徽标**：`site`（档案 blog 字段是真实个人/产品站点）、`product`（Top 仓库带落地页 —— 典型的 SaaS/付费产品特征）、`sponsor`（GitHub Sponsors 列表，配置 token 时经 GraphQL 探测；探测失败记为 null/"unknown"，绝不误报为否）。无公开信号的人显示"无公开变现信号"小字。

```bash
make radar                 # 重新扫描（拉最新档案）
```

`hireable` 标记会与仓库活跃度交叉验证（≤90d 有 push = 真的在找工作），也会与创始人信号交叉验证（bio/company 显示 founder/CEO/CTO → 徽标显示"开放合作/招聘"而非"开放求职"，因为创始人保留该标记是为了招人）。

## 每日自动雷达 + 变更摘要

`scripts/daily-scan.sh`（`make daily`）每天把整套离线管道跑一遍 —— 快照、人脉、水号筛查、评分、雷达 —— 并写一份可读的**逐日变更摘要**到 `logs/daily/<date>.md`：新粉丝 / 取关、新增高手（"新增高手"）、取关水号（"取关水号"）。可安全挂到定时任务（launchd / cron）—— 默认不推送消息（发布需明确指令；`NOTIFY=1` 可推，见「推送到群机器人」）。某个步骤失败会记录在摘要里（并以非零退出码结束），而不是中断丢弃当天数据：每个会被覆盖的步骤先把当前文件快照成 `*.prev.json`，旧数据永不丢失。

```bash
make daily                     # 完整管道（跑雷达建议配 GH_TOKEN）
RADAR=0 make daily             # 只做快照 + 人脉差异（跳过评分/雷达）
DRY_RUN=1 make daily           # 用现有数据直接组摘要（只读，不联网）
```

摘要与 `people_history.jsonl`（`make fetch` / `/api/refresh` 已按天写入）中的前一自然日记录对比，因此即使一天内重试多次，连续运行也能产出可读差异。

## 推送到群机器人（钉钉 / 企微 / Server酱）

推送到群是**显式开关**，默认不发（沿用"发布需明确指令"的约定）。在 `.env` 里配好 webhook 即可：

```bash
# .env
TREND_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=XXX
TREND_WEBHOOK_SECRET=SECxxx      # 钉钉「加签」密钥；用关键词/白名单则留空

make trending-push               # 推 GitHub 趋势榜（daily 窗，Top 10，中文）
SINCE=weekly TOP=15 LANG_FILTER=Python make trending-push
DRY_RUN=1 make trending-push     # 只打印消息，不发送
NOTIFY=1 make daily              # 顺带把当日变更摘要推进群
```

- **趋势榜内容**：优先读本机服务的 `/api/trending`——全局榜现已**直接抓取 github.com/trending 页面**（列表、顺序、星数与该页一致），TTL 缓存，`tr=zh` 机翻描述，群里读中文。服务未运行时**回退直连 GitHub Search API**（按创建时间窗口 + Star 排序，描述保持英文）。
- **消息格式**：纯文本（钉钉/企微/Server酱通用），形如 `📈 GitHub 趋势榜 · 每日 · 2026-10-18` + 逐条 `序号. owner/repo ⭐3.4k · 语言` + 描述。每条仓库后附完整 `https://github.com/<owner>/<repo>` 链接，页脚链到 `https://github.com/trending`——纯文本客户端只对带 scheme 的完整 `https://` URL 自动识别成可点链接（裸 `owner/repo` 或 `github.com/…` 不会跳转）。
- **`scripts/notify.py`** 是传输层：支持钉钉「加签」（仅 `oapi.dingtalk.com` 会拼 `timestamp`+`sign`）、传输层重试（超时/5xx/429）、校验 HTTP 200 里的 `errcode`（企微失败也回 200），并在日志里对带 `access_token` 的 URL 脱敏。它对齐 `work/sale/daoye-signal` 的同名模块。
- 群机器人安全设置三选一：**加签**（推荐，填 `TREND_WEBHOOK_SECRET`）、**关键词**（消息已含"GitHub 趋势"，把关键词设成其中之一即可）、**IP 白名单**。
- **隐私提示——这是全项目唯一把数据发往本机之外的地方。** 趋势榜消息只含公开仓库名/星数/描述；但 `NOTIFY=1 make daily` 推的当日摘要**含他人个人信息：新增/流失粉丝、高分互相关注者、被取关水号的 GitHub 登录名**。仅在对可信群组、且你接受这些人名会发给聊天服务商时才开启。智能体同理：配置了 `LLM_*` 后，聊天会把该 owner 的人脉/雷达数据（他人登录名）发给所配置的端点。

### 定时推送（macOS launchd）

`make trending-push` 是"跑一次发一次"。想每天自动发，装一个 launchd 代理：

```bash
make schedule-install              # 安装并加载，每天 09:00（本地时间）推送
make schedule-install HOUR=8 MIN=30
make schedule-status               # 是否已加载/触发时间/看运行日志
make schedule-uninstall
launchctl kickstart -k gui/$(id -u)/com.lume-talentlens.trending-push  # 立刻推一次（测试）
```

- `scripts/schedule.sh` 把 `scripts/launchd/*.plist.in` 渲染成 `~/Library/LaunchAgents/com.lume-talentlens.trending-push.plist` 并加载；它执行的是 `scripts/trending-push-scheduled.sh`（与 make 目标同一条推送路径——服务在则中文机翻，服务不在则直连 GitHub、英文）。输出写到 `logs/trending-push/scheduled.log`。
- 若到点时 Mac 在睡眠，launchd 会在下次唤醒后**补跑一次**错过的那次。`RunAtLoad` 特意关闭，装完不会立刻触发一次推送。
- `launchd` 仅限 macOS；Linux 上把同一句 `bash scripts/trending-push-scheduled.sh` 挂到 cron 即可。

## 高手档案知识库（`make archive`）

`scripts/archive.py`（`make archive`）把雷达池的盈利信号、盈利模式与变现信号（site / product / sponsor）沉淀为结构化 **markdown 知识库**，供 HR / 学习使用。每人一节：一句话证据、尽力而为的变现标签（Sponsors / 产品落地页 / 个人站 / 卖课 / 咨询）、个人站、公司、所在地、开放求职状态、star 影响力与 Top 仓库；文首汇总表按盈利模式分组人数。完全离线——只读 `radar.json` + `people.json`（需先 `make score && make radar`，或 `make daily`）。写到 `data/github/<owner>/archive.md`（gitignored，属个人数据）；可用 `OUT=/path/to/file.md make archive` 覆盖路径。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
