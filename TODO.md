# TODO — lume-talentlens 开发路线图

状态：已推送 GitHub（公开 erishen/lume-talentlens），CI 全绿；干净历史 + LICENSE + 双语文档 + 测试 + 无敏感数据。
优先级：P0 短期（直接提升日常价值）→ P1 中期（需要设计）→ P2 长期/开源协作。每项含动机、范围、验收标准。

---

## P0 · 短期（价值最高，1-2 轮可落地）

> 本轮 P0 已全部完成（关注/取关趋势时间线 + 健康分历史曲线），见文末「已关闭」。

---

## P1 · 中期（需要设计，收益大）

### 7. 开源协作面（CONTRIBUTING / 模板 / 发版）
- **动机**：对外开源后协作者需要入口。
- **范围**：`CONTRIBUTING.md`（开发环境、make dev、测试要求）；GitHub issue/pr 模板；`make release`（tag + 自动生成 release notes，无 secrets）。
- **验收**：新贡献者按文档 10 分钟内能跑起 `make dev` + 全绿测试。

### 8. 水号规则可配置化
- **动机**：`people-suspects.py` 的判定规则（粉丝/仓库比值、注册时间等）硬编码，不同判断口径调起来要改代码。
- **范围**：规则参数移到 `.env`/配置文件（阈值、权重、是否启用头像/无 bio 信号）；保留默认值兼容现有行为。
- **验收**：不改代码只改配置能切换"严格/宽松"两档水号判定。
- **现状**：已关—— `SUSPECT_MODE=standard|strict|lenient`（默认 standard 复刻历史行为）+ 逐旋钮覆盖 + `SUSPECT_BUZZWORDS`/`SUSPECT_BATCH_NAMES` 词汇替换；`scripts/suspects-selftest.py` 锁定三档矩阵与默认值（26 项断言，纳入 make test）。验收达成：仅改配置即可在 strict（34 high/11 medium）与 lenient（0 high/12 medium）之间切换。

---

## P2 · 长期 / 开源协作

### 9. 多 owner 对比
- 现状是单 owner 雷达。扩展到多账号（自己 + 关注对象）对比：谁的影响力/健康分/活跃方向更像你。服务端 `data/github/<owner>/` 已天然支持多 owner，前端加 owner 切换器即可起步。

### 10. 增量快照更新
- 现在每次全量拉 100 仓库页。改按 `updated_at` 增量（GitHub 支持 `?since=` 语义的 repos 列表分页），省配额、提速。注意保持现有全量 `make fetch` 语义兜底。

### 11. 高手档案知识库
- 从"盈利信号"（P0-1）沉淀为结构化档案：Sponsors 状态、变现方式标签（SaaS/赞助/卖课/咨询）、个人站。可作为 markdown 导出（`make archive`）给 HR/学习使用。可考虑复用 `doubao-book-writer` 思路做成长文档。

### 12. 无障碍与细节打磨（开源友好）
- 键盘导航（面板切换、列表滚动）、ARIA 标签补全、色盲安全配色（信号色已有绿/蓝/橙，检查对比度）、`prefers-reduced-motion`。小步做，每项独立 PR。

### 13. 写接口 Origin/Referer 二次校验
- **动机**：写操作（`/api/follow`、`/api/unfollow`、`/api/refresh`）目前只靠「只收 `application/json` + 服务端不发 CORS 头」防 CSRF；一旦端口被误暴露（改 bind / 端口映射），就只剩这一层。加 Origin/Referer 白名单是纵深防御。
- **范围**：对 POST/DELETE 写接口，若请求带 `Origin`/`Referer`，其 host 必须等于当前 `Host`（或 `127.0.0.1`/`localhost` 白名单）；无 Origin 的本地 curl/脚本保持放行，避免破坏自动化。不匹配返回 403。
- **验收**：跨站 Origin 的 JSON 请求被拒；同源与无 Origin 的 curl 仍成功；guard/单测覆盖三种情形。
- **现状**：已做（适配框架限制）—— CSRF 判定抽成 `sh.write_ct_ok` 并复用于 `/api/follow`、`/api/unfollow`、`/api/refresh`，`tests/shared_guard.lume` 加 8 条断言（JSON、带 charset、大小写、空、null、text/plain、form、multipart；43/43）。**实测本 Lume 构建的 `req` 不含请求头**（只有 `host`/`user_agent`/`remote_addr` 等），无法在应用层读取 Origin/Referer，故维持「Content-Type + 无 CORS + 仅回环」并在 README 安全节注明该限制。若未来框架暴露 header，再补 Origin 白名单。

### 14. 每日推送的 PII 提示与脱敏开关
- **动机**：`NOTIFY=1 make daily` 会把他人 GitHub 登录名（新增/流失粉丝、高分互关、被取关水号）发往钉钉；当前仅靠 README 提示，运行时无确认/脱敏手段。
- **范围**：非 `DRY_RUN` 推送前打印一行「将发送含他人登录名的摘要」，`NOTIFY_YES=1` 跳过确认；可选 `--redact-logins` 把登录名打码（如 `er***en`）后再发；README 同步。
- **验收**：默认推送打印提示且行为不变；`NOTIFY_YES=1` 静默；`--redact-logins` 输出不含完整登录名（`notify-selftest.py` 断言）。
- **现状**：已做 —— `notify.py` 新增 `redact_logins()` + `--redact-logins`（反引号登录名打码，`erishen`→`er***en`）；`make daily` 在 `NOTIFY=1` 时默认向 stderr 打印 PII 提示，`NOTIFY_YES=1` 静默，`REDACT_LOGINS=1` 以脱敏版推送；`notify-selftest.py` 新增 6 条断言（含「先脱敏后拍平」顺序）。

### 15. 本机 PII 驻留治理（保留期/清理）
- **动机**：`data/github/*.json`、`.data/`（智能体会话记录）、`logs/` 为明文 PII，仅靠 gitignore，长期累积。
- **范围**：给 `.data/` 加可配置保留期（默认 30 天）并纳入 `make cleanup`；可选 `make purge-owner OWNER=...` 清理单个 owner 的快照。
- **验收**：超期会话文件被清理；`make cleanup` 幂等；文档说明清理范围。
- **现状**：已做 —— `scripts/purge.sh`：默认按 `SESSIONS_TTL_DAYS`（默认 30，0 关闭）清理 `.data/sessions/*.json`，`--owner <login>` 显式删除 `data/github/<login>/`（字符集/保留名校验、`--dry-run`）；新增 `make purge` 与 `make purge-owner OWNER=<login>`（幂等）；README 安全节、`.env.example` 已说明。注：项目原有的 `scripts/cleanup.sh` 是进程/端口清理库，未改其语义。

### 16. 令牌最小权限与轮换说明
- **动机**：follow/unfollow 需 `user:follow`，而趋势/分析只需只读；单 token 混用扩大泄露面。
- **范围**：README 安全节补「只读 token（`public_repo`/`read:user`）+ 独立 `user:follow` token」的 scope 矩阵与配置方式；`.env.example` 标注。
- **验收**：文档给出「只读 / 关注」两套 scope 及各自启用方式。
- **现状**：已做 —— README 中英「安全与隐私」节新增「令牌最小权限」：读取用无 scope 的 classic token（仍 5000 次/时）或仅公开仓库只读的 fine-grained token；`user:follow` 单独签发。`.env.example` 的 `GH_TOKEN` 注释同步标注。

---

## 已关闭（2026-10 前完成，不再列入）
- **无障碍与细节打磨（P2-12，首批）**：WAI-ARIA tabs —— `TabBar` 组件（role=tablist/tab、aria-selected、aria-controls、roving tabindex，Left/Right/Home/End 键盘导航，抽取为可测组件 + 7 单测）；五个 tab 版面全部 role=tabpanel + aria-labelledby；状态区 aria-live（live 拉取/人脉/refresh、pool 进度）与错误区 role=alert；忙态按钮 aria-busy（分析/pool 排名/对比/搜索）；i18n 键 tabs.role（中英）。`:focus-visible` 焦点环与 `prefers-reduced-motion` 此前已有；muted 对比度 ~6.5:1（AA）。剩余小项（对比度全色板、下拉键盘等）留待后续独立 PR。
- **多 owner 对比（P2-9）**：既有实现 —— 1v1 并排对比（`ComparePanel`：健康分/仓库/活跃/质量分/主导语言/粉丝/star，双方走同一 `deriveTalent`+`healthScore` 管线）+ N 人候选池（`usePool`：多 owner 按健康分排名，并行拉取、getGithub 节流防 429、池外 owner 走 live 拉取）。前端已接线（Dashboard 对比输入框 + 人才池输入框）。radar.json 天然按 owner 存放，服务端无需改动。pool/panels 单测覆盖。
- **高手档案知识库（P2-11）**：`scripts/archive.py`（`make archive`）把雷达池变现信号 + 盈利模式导出为结构化 markdown 档案（一句话证据、变现标签 Sponsor/产品落地页/个人站/卖课/咨询、公司/所在地/hireable、star 影响力、Top 仓库 + 汇总表），供 HR/学习；离线，写到 `data/github/<owner>/archive.md`（gitignored），`OUT=` 可覆盖。数据驱动：在真实雷达池上产出可读档案（6 人实测）。
- **智能体增强：雷达问答（P1-6）**：`radar_insights(owner, query, min_score, top)` 工具——按空格分词 AND 过滤雷达池（bio/证据 note/公司/模式/重点仓库名+描述），`min_score` 抬分、`top` 限数、按分数降序返回命中者的证据摘要；离线读 radar.json；`/discovery` 工具清单 + tools.lume 纯函数 + `tests/radar_insights_guard.lume`（13 断言）。
- **水号规则可配置化（P1-8）**：见上文 P1-8 条目。
- **每日自动雷达 + 变更提醒（P1-5）**：`scripts/daily-scan.sh`（`make daily`）编排 快照+人脉+水号+评分+雷达 一遍，产出逐日摘要到 `logs/daily/<date>.md`（新粉丝/取关、新增高手、取关水号、水号新发现）；与前一日 people_history 对比（一天内重试也不重复）；失败步骤记入摘要且退出码非零、覆盖前快照 `*.prev.json` 保数据；`DRY_RUN=1` 只读组摘要、`RADAR=0` 跳过评分/雷达。验收：fixture 两天数据产出可读差异摘要，DRY_RUN 幂等。
- release 版 64KB 响应塌陷 → 切 full build
- 模块化拆分（1059 行 → 8 模块）
- 测试/CI（40 vitest + 25 smoke + typecheck）
- CSV 公式注入、CSRF（写操作 Content-Type 白名单）
- 中英切换、水号/雷达、follow/unfollow、live 缓存、头像放大、智能体 UI
- 高手盈利模式分析（P0-1：radar 面板💎/🌐/🛍 变现信号徽标 + radar.json 证据 + 验收达成）
- live 缓存可见性（P0-4：fetchLive 带 cached/elapsedMs，UI 显示耗时与冷热 chip，77 vitest 全绿）
- **关注/取关趋势时间线（P0-2）**：`people_history.jsonl`（`make fetch` + `/api/refresh` 每日 upsert），`/api/people_history` 差分任意两天；前端「人脉 → 趋势时间线」子视图，周聚合 + 点开看具体名单（点名字可应用内分析）。验收：可复核"上周谁新关注/取关"（`tests/history_guard.lume` + 4 个 vitest）。
- **健康分历史曲线（P0-3）**：`health_from_overview`（服务端镜像 `talent.ts` 公式，含 log10/clamp），`/api/overview` 幂等记录进 `health_history.jsonl`，`/api/health_history` 读取；前端健康分卡片加 sparkline，按当前权重重算。验收：二次扫描可见分数曲线，数据来自真实历史（guard 24/24、112 vitest 全绿）。
