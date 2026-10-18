# Contributing to lume-talentlens

Thank you for your interest! This document is the on-ramp for new
contributors — a working `make dev` + green tests should take under 10
minutes.

## Project layout

```
app/           Lume backend: github.lume (entry) + lib/*.lume modules
frontend/      React + TypeScript dashboard (esbuild bundle -> www/github/)
scripts/       shell/python helpers (fetch, score, radar, suspects…)
tests/         .lume guard unit tests
www/github/    static SPA shells + shared stylesheet
```

See [ARCHITECTURE.md](ARCHITECTURE.md) (Chinese) for a deep dive on layers,
data model and data flows.

## Local dev

### Prerequisites

- **Node 22+** and **pnpm** (the vitest/jsdom stack pulls in undici 8).
- **A full Lume build** — the app needs the outbound-HTTP builtins
  `http_get` / `http_put` / `http_delete`. The release binary does not ship
  them. Build Lume from source:

  ```bash
  git clone --recurse-submodules https://github.com/erishen/lume.git ~/src/lume
  make -C ~/src/lume
  ```

  Point the app at it:

  ```bash
  LUME=~/src/lume/bin/lume make dev
  ```

  `make dev` probes the binary and refuses to start with an incapable one.

### First run

```bash
cp .env.example .env        # edit: OWNER, GH_TOKEN, LLM_* (never commit .env)
cd frontend && pnpm install # frontend deps (react, esbuild, typescript)
make fetch                  # snapshot your repos -> data/github/<owner>/
make dev                    # kill :8091 + build UI + esbuild watch + server
```

The server always runs in the **foreground** — there is no `make run`.

## Common tasks

| Task | Command |
| --- | --- |
| Type-check `.lume` + runtime sanity | `make check` |
| Snapshot a different owner | `make fetch OWNER=foo` |
| Build the React bundle | `make ui` |
| Rank followers by influence | `make score` |
| Flag water accounts (zero API cost) | `make suspects` |
| Talent-radar profit-pattern scan | `make radar` |
| Frontend unit tests + `.lume` guards | `make test` |
| Boot isolated server + assert contracts | `make smoke` (use `SKIP_LIVE=1` to skip network) |
| Print the classification rollup | `make classify` (needs a running server) |
| Diagnose the LLM translation path | `make llm-check` |

## Testing

- **`.lume` guards** (`tests/*.lume`): pure-function unit tests for the Lume
  runtime. Run via `make test` (or `lume tests/<name>.lume` directly).
- **Frontend tests**: `cd frontend && pnpm test` (vitest + jsdom). Pure
  logic — talent derivation, i18n parity, CSV escaping, live-core.
- **Smoke**: `make smoke` boots an isolated server and asserts every public
  contract the frontend/agent relies on.

When adding a new behavior, add a guard test alongside it. PRs that touch a
route or a data file without a corresponding `tests/*.lume` entry will not
merge.

## Code style

- Comments explain **WHY**, not WHAT. Code should be self-documenting.
- `.lume` modules are deliberately thin: routes/tools live in `app/lib/`,
  pure analysis in `app/lib/analyze.lume`. Don't put route logic in
  `analyze.lume` and vice versa.
- Keep responses under the framework's body cap (65536 bytes) — page repos
  at 50/page, cap lists.
- **Never commit secrets.** `.env` is gitignored. `make` deliberately does
  not `-include .env` so credentials never leak into `make -pn` debug output.

## Pull requests

1. Open an issue first for anything non-trivial (new scan, new route, a
   refactor).
2. Branch from `main`; squash-merge style commits.
3. `make check`, `make test`, `make smoke` must be green.
4. Keep PRs focused — one feature per PR.
5. Add or update tests; update `README.md` / `README.zh.md` / `TODO.md` if
   the user-facing behavior changes.

## Releases

```bash
make release         # tag + push; release notes are generated from git log
```

`make release` tags the commit, pushes the tag, and prints the release-notes
skeleton for you to fill in. Never commit a token or key in a release —
artifacts are source-only.

## Questions?

Open a discussion on GitHub, or reach the maintainer directly.