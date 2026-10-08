# lume-talentlens

一个招聘视角的 GitHub 人才信号仪表盘：读取一个人的 GitHub 足迹，呈现**人才信号** —— 档案（求职中、社交链接）、工程严谨度、产出节奏、技术焦点、社区参与。基于 **Lume** 单二进制 C 框架（必须是 **full build**，见[环境要求](#环境要求)）与 **React + TypeScript** 前端。

> Lume 提供 `.lume` DSL 来写路由 / SSR / 智能体工具，外加一个原生 HTTP 服务器（仅回环地址）与内置 LLM 聊天智能体。本项目把它接到 `github.com` 仓库的本地快照上，因此整个系统可以离线运行。

## 环境要求

- **完整版 Lume build** —— 应用默认使用 `LUME ?= ../research/lume/bin/lume`（与本仓库平级的完整构建；在 `../research/lume` 里 `make` 即可）。可用 `LUME=/path/to/lume` 覆盖。**release 版二进制会在启动时被拒并给出明确提示** —— 见下面的出站 HTTP 说明。
- **Node 18+ / pnpm** 用于前端（`(cd frontend && pnpm install)`）。
- 可选：`.env` 中的 `OWNER` / `GH_TOKEN` / `LLM_*`（见[配置（.env）](#配置env)）。

> **出站 HTTP 说明：** Lume 的 *release* 二进制（agent-httpd 1.0）**不带** `http_get` / `http_put` / `http_delete` 内建函数，因此实时拉取代理（`/api/live/github`）、人脉刷新（`/api/refresh`）与关注/取关接口都无法在它上面工作。本项目因此**必须使用完整 build**；`make dev` 会探测二进制能力，能力不足时拒绝启动。

## 项目结构

深入的分层、数据模型、数据流与关键机制见 [ARCHITECTURE.md](ARCHITECTURE.md)（中文架构文档）。

```
app/
  github.lume        # 入口：import 各 lib 模块、server{}、run()
  lib/analyze.lume   # 纯分析函数（直方图、排序、视图、bundle）
  lib/shared.lume    # owner / 快照 / 字符串 helpers + gh_get（各模块共享）
  lib/api.lume       # JSON 接口：owners/overview/repos/…/people/refresh/people_diff
  lib/live.lume      # 实时 GitHub 代理（/api/live/github）+ 鉴权探针
  lib/ssr.lume       # SSR 页面（/overview、/repos、/api 参考）
  lib/tools.lume     # LLM 智能体工具（repo_* / github_*）
  lib/actions.lume   # /discovery + POST /api/follow + DELETE /api/unfollow
  lib/ui.lume        # SSR 页面组件（nav、kpi、bars、repo_row、page）
frontend/
  src/main.tsx       # React 入口 —— Dashboard（默认）或 Agent（data-page=chat）
  src/Dashboard.tsx  # KPI、语言/节奏/年份柱状图、Top-10、搜索、分页列表
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
make dev PORT=9000
```

服务始终运行在**前台** —— 没有后台版 `make run`；`make dev` 是唯一的开发循环，启动前会先杀掉占用该端口的旧服务。

打开 <http://127.0.0.1:8091/> 看 React 仪表盘，`/chat` 是智能体，其余见下方路由表。

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
| `LIVE_CACHE_TTL_SEC` | 可选 `/api/live/github` 内存响应缓存 TTL 秒数（默认 300；`0` 关闭）。重复浏览同一档案时从缓存返回，省 GitHub 配额与延迟。 |

以上每个键都会在 `make dev` 启动时由 **Makefile 导出给应用/服务进程**（`-include .env` 旁有 `export …`）—— 服务器自身也有一个懒加载的 .env 读取器，但显式导出才是可靠路径。shell/python 脚本同样会 source `.env`。其中任何一个也可以用普通环境变量传入（如 `OWNER=acme make fetch`），后者永远优先。

> 服务器只绑定 `127.0.0.1`。智能体与仪表盘针对**本地快照**分析已缓存的 owner；未缓存的 owner 通过服务器的 `/api/live/github` 路由按需拉取 —— 该路由用 Lume 内建 `http_get()` 从宿主机调用 GitHub REST API（经 libssl 出站 TLS），并**把响应投影为应用消费的字段**（原始 100 仓库页约 250KB，会撑破框架的响应上限）。设置 `GH_TOKEN` 拿到 5000 次/时的鉴权配额；不设置时共享服务器 IP 匿名限 ~60 次/时。设置 `LLM_*`（见配置表）启用真实模型聊天；否则由离线兜底引擎应答。写操作（`/api/follow`、`/api/unfollow`）**只接受 `Content-Type: application/json`**（CSRF 防护：跨站 JSON fetch 被浏览器 preflight 阻断——服务器不发 CORS 头；HTML form / text-plain 载体在解析 body 前被 403 拒绝）。

> **两层视图。** SSR 页面（`/overview`、`/repos`、`/api`）是同一快照的只读、零依赖视图。`/` 的 React 仪表盘才是完整交互产品：人才信号、综合健康分、可复制的 HR 备注、并排对比、push 活跃趋势、以及未缓存 owner 的服务端实时数据。HR / 招聘方要落地使用，优先 React 仪表盘。
>
> `make dev` 是唯一的开发循环（Ctrl-C 同时停服务与 watcher）；启动前会杀掉端口上的旧服务、清理过期智能体会话记录（`.data/sessions`，保留最新 30 份）、轮转 `logs/access.log`。

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
| GET | `/api/refresh` | 服务端重新拉取粉丝/关注 + 档案总数，重写 `people.json`（限流，每 owner 60 秒） |
| GET | `/api/live/github?path=/users/<x>` | 服务端 GitHub 代理（出站 `http_get`）；返回 `{ ok, status, data, err }` —— 大载荷先投影再返回 |
| GET | `/api/github_auth` | `{ authed: bool }` —— live 调用是否带 `GH_TOKEN`（5000 次/时）；绝不泄露 token |
| GET | `/discovery` | 启动期工具/技能/MCP 目录 |
| POST | `/api/follow` | 用 PAT 关注某人 —— body `{ "login": … }`（幂等，204；需要 `user:follow`） |
| DELETE | `/api/unfollow` | 用 PAT 取关某人 —— body `{ "login": … }`（幂等，204；需要 `user:follow`） |

> 框架对单个响应体有上限，因此 `/api/overview` 只给聚合，完整仓库列表经 `/api/repos` 分页，live 代理也会把原始 GitHub JSON 投影到应用消费的字段。

## 智能体工具

`repo_insights`、`repo_search`、`repo_language`、`repo_recency`、`repo_year`、`repo_stats` —— 都读内存快照并返回紧凑 JSON。`github_story` 把同一份数据组织成面试自我介绍 / 项目故事素材。人脉侧工具：`github_owners`（已缓存 owner + 默认）、`github_radar`（互相关注高分者按盈利模式分组 —— startup / crypto / company / content / tools / hunting / other，附一行证据）、`github_people`（粉丝/关注首页 + 总数 + 合并的水号嫌疑标记 + 互相关注重叠）。问智能体"我人脉里谁是真正的高手 / 他们怎么赚钱 / 哪些是水号"，它会用本地数据 + radar/people 工具作答。

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

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
