# lume-talentlens 架构文档

> 面向代码阅读者与协作者。描述系统分层、数据模型、运行时数据流与关键机制。
> 配套阅读：[README.md](README.md)（使用入门）、[README.zh.md](README.zh.md)（中文使用入门）。

---

## 1. 定位与总览

lume-talentlens 是一个**招聘视角的 GitHub 人才信号分析器**：读取一个人的 GitHub 足迹，输出"值得关注 / 值得雇佣"的判断素材（求职状态、工程产出、技术焦点、人脉质量）。它解决的核心问题是——把 GitHub 公开数据组织成可行动的招聘/人脉决策信息。

整体拓扑（浏览器只与本地服务通信，出站只有两处：GitHub REST API、LLM 端点）：

```
┌─────────────── 浏览器（127.0.0.1:8091）───────────────┐
│  React SPA (/、/chat)         SSR 页 (/overview 等)    │
└───────────────┬───────────────────────┬───────────────┘
                │ 同源 JSON / SSE         │ 同源 HTML
┌───────────────▼───────────────────────▼───────────────┐
│                Lume server（单二进制，prefork×4）        │
│  入口 github.lume → lib/*（路由/工具/渲染）              │
│  bind 127.0.0.1:8091                                   │
└───┬───────────────┬───────────────────┬───────────────┘
    │ 读本地文件      │ 出站 http_get()    │ LLM 桥（智能体）
    ▼                ▼                   ▼
data/github/<owner>/   api.github.com      OpenAI 兼容端点
（快照/人脉/雷达）      （live 代理）       （/chat 工具调用）
```

两条数据来源，一条服务路径：

- **离线快照（默认）**：`scripts/fetch-github.sh` 预取到 `data/github/<owner>/`，服务端只读本地文件，零网络、可离线。
- **实时代理（按需）**：未缓存 owner 经 `/api/live/github` 由**服务端**代拉 GitHub API，绕开浏览器 CORS/出口限制。

---

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 服务端 | **Lume**（C 单二进制） | `.lume` DSL 提供路由/SSR/智能体工具 + 原生 HTTP 服务器 + LLM 聊天桥。**必须 full build**（release 版无出站 HTTP 内建，启动探针会拒绝） |
| 前端 | **React 18 + TypeScript** | esbuild 打包（无 webpack/vite），pnpm 管理依赖 |
| 打包 | esbuild（`scripts/build-ui.sh`） | `frontend/src/main.tsx → www/github/app.js` |
| 数据管道 | **bash + Python3 + curl** | 无第三方 Python 依赖 |
| 密钥/配置 | `.env`（gitignored） | Makefile `export` 注入，另有 `scripts/env.sh` |

---

## 3. 目录结构与职责边界

```
lume-talentlens/
├── app/                       # Lume 应用（服务端全部逻辑）
│   ├── github.lume            # 入口：import 全部模块 + server{} + run()（84 行）
│   └── lib/                   # 模块化拆分后的 8 个职责单元
│       ├── analyze.lume       # 纯分析函数（无 IO/无 env/无路由）
│       ├── shared.lume        # 共享层：owner/快照/字符串 helpers + gh_get
│       ├── api.lume           # JSON 路由（16+ 端点）
│       ├── live.lume          # live 代理 + 鉴权探针
│       ├── ssr.lume           # SSR 页面
│       ├── tools.lume         # 智能体工具（repo_* / github_*）
│       ├── actions.lume       # follow/unfollow 写操作
│       └── ui.lume            # SSR 渲染组件
├── frontend/src/              # React 前端
│   ├── main.tsx               # 入口：Dashboard / Agent 二选一
│   ├── Dashboard.tsx          # 仪表盘页（组装 panels/lists/bars/pickers）
│   ├── dashboard/             # 拆分后的子组件 + 数据 hook
│   ├── Agent.tsx              # SSE 聊天客户端
│   ├── api.ts / types.ts      # API 客户端 + 共享类型
│   ├── live.ts / talent.ts    # 实时数据 / 人才信号计算
│   ├── i18n.ts / LangSwitch.tsx  # 中英双语
│   └── markdown.tsx / exportCsv.ts
├── www/github/                # 静态产物（views 目录，index.html 挂 "/"）
├── data/github/<owner>/       # 快照与派生数据（全部 gitignored）
├── scripts/                   # 离线管道（fetch/suspects/score/radar/follow/unfollow）
├── Makefile                   # check / fetch / ui / dev
└── .env.example               # 配置模板（提交），.env 真实值（忽略）
```

---

## 4. 服务端分层设计

拆分原则：**入口只做组装，路由按能力分模块，纯计算与 IO 严格分离**。依赖方向单向：

```
入口 github.lume
  ├─→ lib/actions.lume ──→ shared（owner 解析）
  ├─→ lib/tools.lume ────→ shared + analyze
  ├─→ lib/ssr.lume ──────→ shared + analyze + ui
  ├─→ lib/api.lume ──────→ shared + analyze
  └─→ lib/live.lume ─────→ shared（gh_get）
                          analyze.lume  ← 纯函数层（谁都不依赖它之外的东西）
                          ui.lume       ← SSR 渲染（纯函数 + i18n 字典）
```

| 模块 | 职责 | 依赖 | 关键约束 |
|---|---|---|---|
| `analyze.lume` | repo_view / analyze / insight / story_pack / 各直方图 | 无 | **纯函数**：`(repos, snap)` 进、JSON 出；无 IO、无 env、无路由 |
| `shared.lume` | owner 解析、快照读取、字符串/数组 helpers、`gh_get`（带重试） | analyze | 被所有模块引用；不放路由 |
| `api.lume` | 全部 JSON 端点 + people 合并（水号/评分标签）+ refresh | shared, analyze | 响应体必须小于框架上限（见 §7.3） |
| `live.lume` | `/api/live/github` 代理 + `/api/github_auth` | shared | 路径白名单 + slim_body 投影 |
| `ssr.lume` | /overview /repos /api 三页 | shared, analyze, ui | 只读视图，无 JS 依赖 |
| `tools.lume` | 10 个智能体工具注册 | shared, analyze | 工具在 fork 出的 worker 上运行，每次读快照 |
| `actions.lume` | /discovery + follow/unfollow | 无 | 写操作需要 `user:follow` PAT |

### 4.1 Lume 模块机制（拆分的基石）

- **import 时顶层注册生效**：`get/post/tool` 写在模块顶层，入口 `import` 即完成路由/工具注册（无需显式调用）。
- **嵌套 import 相对模块自身目录**：`lib/shared.lume` 里引用同目录文件写 `import "analyze.lume"`，不能写 `lib/...` 前缀。
- **`export func` 跨模块可调**：导出函数可被任意 import 方调用。
- **模块导出不传播突变**：导入方对入参 map/array 的修改不会传回导出方——因此 `analyze.lume` 的纯函数显式接收并返回数据，`api.lume` 自己组装合并结果。

---

## 5. 数据模型

### 5.1 快照 `data/github/<owner>/snapshot.json`（管道产物，服务端只读）

```json
{
  "fetched_at": "2026-10-06T08:48:33Z",
  "owner": "erishen",
  "profile": { "login", "name", "avatar_url", "bio", "company",
               "location", "blog", "twitter_username", "hireable",
               "followers", "following", "public_repos", "public_gists",
               "created_at" },
  "count": 110, "non_fork_count": 98,
  "repos": [ { "name", "full_name", "language", "stargazers_count",
               "forks_count", "open_issues_count", "fork", "archived",
               "description", "html_url", "topics", "created_at",
               "updated_at", "pushed_at", "size", "license",
               "created_year", "age_days", "days_since_push",
               "days_since_updated", "recency", "push_month" } ]
}
```

要点：原始 API 的 100 字段被管道投影为 **~24 字段/仓库**，且**派生字段在管道里预计算**（`created_year`、`recency` 分桶、`push_month`），服务端只做聚合不做重算——这是 JSON 保持小巧、接口毫秒级返回的原因。

### 5.2 人脉与衍生数据（同一 owner 目录）

| 文件 | 来源 | 用途 |
|---|---|---|
| `people.json` | `make fetch` 或 `/api/refresh` | 粉丝/关注首页列表 + totals |
| `people.prev.json` | `/api/refresh` 覆盖前自动归档 | `/api/people_diff` 的对比基准 |
| `suspects.json` | `make suspects`（本地启发式，零 API 成本） | 水号/招聘方预筛查，按 login 合并进 `/api/people` |
| `scores.json` | `make score` | 影响力评分（profile-only：仓库/触达降权 + 粉丝-关注比 + 水号扣分，cap 93） |
| `radar.json` | `make radar`（每人 3 次 API 调用） | 互相关注高分者（≥60）按盈利模式分类，star 质量分重排（cap ≈123） |
| `last_owner` | 每次 fetch 写入 | 默认 owner（低于 `OWNER` env） |

> **owner 作用域**：`suspects.json` 预筛查只对配置的 `OWNER`（.env 的 OWNER，即用户本人账号）合并；分析任意他人只读快照，不做水号判定。

### 5.3 隐私边界（gitignore）

`.env`、`data/github/`、`logs/`、`.data/` 全部 gitignored —— 公开克隆不携带任何个人数据与密钥（详见 §10）。

---

## 6. 数据管道（离线，脚本层）

```
fetch-github.sh ──► snapshot.json        （分页 /users/<owner>/repos，预计算派生字段）
people-suspects.py ─► suspects.json      （本地启发式水号筛查，零 API 成本）
people-score.sh ───► scores.json         （影响力评分，全部粉丝/关注：仓库/触达降权 + 粉丝-关注比 + 水号扣分）
radar-scan.sh ─────► radar.json          （互相关注高分者≥60 按盈利模式分类；star 质量分重排；变现信号：site / product / sponsor=GraphQL 探针，失败记 null 不误报）
follow-worthy.sh ──► （写操作）回关未关注的高分粉丝（幂等，需 PAT）
unfollow.sh ───────► （写操作）批量取关水号（数据驱动读 suspects.json，--dry-run 可预览）
```

管道全是**离线/一次性**作业，与常驻服务解耦；服务端只读这些产物。`/api/refresh` 是唯一服务端触发的写入（重拉 people.json，60 秒/owner 限流）。

---

## 7. 运行时数据流

### 7.1 静态/缓存路径（默认）

```
GET /api/overview?owner=x
  → shared.load_snap(x)            读 data/github/x/snapshot.json（缺→ no_snapshot 404 体）
  → analyze.analyze_lite(repos,snap)  纯函数聚合
  → JSON 响应（毫秒级）
```

### 7.2 live 代理路径（未缓存 owner）

```
浏览器 fetch /api/live/github?path=/users/x/repos
  → live_safe_path 校验（必须 /users/ 前缀、禁 : // 空格 .. 、限长 512）
  → shared.gh_get("https://api.github.com" + path, headers)   // 服务端出站，TLS via libssl
  → slim_body 投影（/repos → 16 字段/条；/followers|/following → 5 字段；profile → 15 字段）
  → { ok, status, data(JSON 文本), err }   // 浏览器 JSON.parse(data)
```

为什么这样设计：
- 浏览器对 `api.github.com` 有 CORS/出口限制，服务端出站天然没有；
- 原始 100 仓库页 ~250KB，**超出框架响应上限**，slim_body 必须先投影再返回；
- `path` 白名单校验防 SSRF 式滥用（固定 host + 路径守卫）。

### 7.3 响应体上限的三道应对

Lume 框架对单响应体有硬上限（release 版实测 64KB 塌陷；full build 高得多但仍有上限）。全项目统一三种策略：

1. **聚合**：`/api/overview` 只返回统计值，不返回仓库列表；
2. **分页**：`/api/repos?offset=&limit=`，单页上限 50（50/页 ≈ 30KB，留足余量）；
3. **投影**：live 代理把原始 GitHub JSON 瘦身到应用消费字段。

### 7.4 智能体路径（/chat）

```
React Agent.tsx ──SSE──► Lume LLM 桥 ──► 配置的 OpenAI 兼容端点（LLM_API_URL）
                              │
                              ▼
              工具注册表（tools.lume 的 10 个 repo_*/github_*）
              LLM 请求工具 → fork worker 读本地快照 → 结果回填对话
```

- 未配置 `LLM_*` 时用**内置离线兜底引擎**（可回答，无模型依赖）；
- `LLM_SYSTEM_EXTRA` 追加系统提示（数据来源/引用纪律/输出语言）；
- `LLM_TIMEOUT` 控制上游流超时；
- 智能体会话存 `.data/sessions`（`make dev` 启动时清理，保留最新 30 份）。

### 7.5 多 owner 解析优先级

```
?owner= 参数  >  OWNER env/.env  >  data/github/last_owner  >  默认（第一个缓存）
```

每个 JSON 端点都可带 `?owner=`；缺快照时统一返回 `{status:404, error:"no_snapshot", hint:"OWNER=x make fetch"}`。

---

## 8. 前端架构

### 8.1 组件树

```
main.tsx（路由：/ 仪表盘  |  /chat 智能体）
├── Dashboard.tsx（组装）
│   ├── dashboard/useDashboard.ts     # 数据 hook：拉取 + 派生（互相关注/值得关注/高分）
│   ├── dashboard/pickers.tsx         # owner 选择器 + live fetch
│   ├── dashboard/panels.tsx          # 概览/人才信号/对比面板（HR 视角）
│   ├── dashboard/lists.tsx           # 粉丝/关注/水号/值得关注列表 + 雷达面板（人像卡片 + tooltip 证据 + 变现信号徽标）
│   ├── dashboard/bars.tsx            # 语言/活跃/年份柱状图
│   ├── LangSwitch.tsx + i18n.ts      # 中英切换（所有文案走字典）
│   ├── exportCsv.ts                  # 列表导出 CSV
│   └── live.ts / talent.ts           # 实时代理客户端 / 前端人才信号
└── Agent.tsx（SSE 聊天 + markdown.tsx 渲染 + 工具调用展示）
```

### 8.2 状态与数据约定

- `types.ts` 定义全部 API 契约（`PersonView.api` 嵌套对象 = 水号判定证据：followers/repos/created/note）；
- `api.ts` 统一 fetch 封装；`live.ts` 只消费 `/api/live/github` 的 `{ok,status,data,err}` 信封；
- 列表按影响力排序（服务端 `scores.json` 合并），高分打徽标；水号 chip 的 tooltip 显示判定依据；
- 双语：`i18n.ts` 字典 + `LangSwitch`，切换持久化。

---

## 9. 启动与构建链路

```
make dev（唯一开发循环，前台）
  ├─ scripts/cleanup.sh   杀占用 :8091 的旧服务 + esbuild watch
  ├─ scripts/build-ui.sh  pnpm 装依赖（如缺）→ esbuild 打包前端
  ├─ scripts/dev.sh       启动能力探针：printf 'print(http_get);' | $LUME -
  │                       （release 版报 undefined → 拒绝启动，提示需 full build）
  └─ $LUME app/github.lume  前台运行（Ctrl-C 停服务+watcher）
```

- `LUME ?= ../research/lume/bin/lume`（Makefile 与 dev.sh 同默认），可用 `LUME=` 覆盖、`PORT=9000`/`LUME_GITHUB_PORT` 改端口；
- server 配置：`workers=4`（prefork）、`bind=127.0.0.1`、`docroot=./www`、`views=github`。

---

## 10. 隐私与安全边界

| 机制 | 实现 |
|---|---|
| 网络暴露面 | 只绑定 `127.0.0.1`，无外网监听 |
| 凭据不进代码 | `.env` gitignored；`scripts/env.sh` 加载时抑制 `bash -x` 防回显 |
| 凭据不进日志 | access.log 只记路径；token 只进 `Authorization: Bearer` 头 |
| Lume env() 遮蔽 | 名字含 TOKEN/API_KEY/SECRET/PASSWORD 的变量对脚本不可见 → 应用读别名 `GH_ANALYZER_PAT`（Makefile 由 GH_TOKEN 映射） |
| 响应不泄密 | `/api/github_auth` 只回 `{authed:bool}`；live/refresh 响应不含 token |
| 静态资源 CSP | `img-src 'self' data:` + 可配置追加（`AGENTHTTPD_CSP_IMG_SRC=https://avatars.githubusercontent.com`） |
| 写操作 | follow/unfollow 幂等（204）；需要 `user:follow` PAT；`unfollow.sh` 支持 `--dry-run` |
| 写操作 CSRF | follow/unfollow 只接受 `Content-Type: application/json`（前端 fetch 显式携带）：跨站 JSON 被服务器无 CORS 头 + preflight 阻断，HTML form / text-plain 载体在解析 body 前被 403 拒（2026-10-08 加固） |
| 数据隔离 | 快照/人脉/雷达全在 gitignored 的 `data/github/`；代码无硬编码 owner |

---

## 11. 演进方向与已知限制

- **`/discovery` 500**：`discovery_endpoints/skills/tools/mcps` 内建在当前 full build 未定义（框架能力差异，非应用回归）；前端未引用。若要启用需确认这些内建在哪种构建配置下存在。
- **refresh 限流**：`/api/refresh` 每 owner 60 秒一次（防匿名配额耗尽）；匿名 live 全局限 ~60 req/h，配置 GH_TOKEN 后 5000 req/h。
- **people 仅首页**：`people.json` 只存粉丝/关注首页（各 ≤100）；全量列表由 `make fetch`/`people-scan.sh` 离线补齐。
- **LLM 可替换**：`LLM_API_URL` 指向任意 OpenAI 兼容端点即可换模型；未配置时离线兜底。
- **对外开源就绪**：LICENSE(MIT) + 双语 README + 本架构文档 + 无敏感数据入库；尚未推送远端（git 无 remote）。
