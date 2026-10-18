---
name: Pull request
about: Template for contributions to lume-talentlens
---

## Summary

One or two sentences: what this PR does and why.

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor / cleanup
- [ ] Docs
- [ ] Tests

## Motivation

Link the issue this closes (or explain the problem). See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow.

## Scope

What's in, what's out. Keep PRs focused — one feature per PR.

## Verification

- [ ] `make check` — `.lume` type-check + runtime sanity
- [ ] `make test` — `.lume` guards + frontend unit tests
- [ ] `make smoke` — isolated server + public contracts
- [ ] `make dev` — starts cleanly on the default port

## User-facing changes

- [ ] `README.md` / `README.zh.md` updated
- [ ] `TODO.md` roadmap updated (items moved to "已关闭" if completed)
- [ ] New i18n keys added to `frontend/src/i18n.ts` **and** mirrored in
      `app/lib/ui.lume` (SSR pages)

## Security

- [ ] No secrets committed (`.env` is gitignored; `make` never includes it)
- [ ] Write endpoints still reject non-`application/json` Content-Type
- [ ] Owner params still sanitized (no path traversal into `data/github/`)