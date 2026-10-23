# AGENTS.md

## Product

Answerline is an open-source, self-hosted AI voice receptionist: it answers phone (SIP) and web calls, answers from a knowledge base, books appointments, and logs every call on infrastructure the user owns. It is an open alternative to hosted voice-agent platforms.

Principles:
- **Own your stack.** Everything runs on the user's infra; call data stays in their Postgres.
- **Bring your own keys.** Every model stage (STT, LLM, TTS, embeddings) is a pluggable provider. No vendor lock-in, no required cloud service.
- **Config and code, not a builder.** An agent is one YAML file (`agents/*.yaml`); the dashboard edits the same schema.
- **Measured, not guessed.** Changes to prompts or models should be checkable with evals; latency and cost are first-class.
- **Latency is the product.** Anything in the live call path must be fast; push slow work to the worker.

`README.md` is the vision we work backward from. `tasks.md` is the roadmap; check items off when they land.
Keep `tasks.md`, the corresponding GitHub issues, and the Answerline Roadmap GitHub Project in sync. When roadmap scope, decisions, or status change, update every affected issue and project item in the same task and verify all three agree before finishing.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 dashboard + REST API (shadcn/ui on Base UI, Tailwind 4). Has its own `AGENTS.md` for Next.js rules. |
| `apps/worker` | BullMQ jobs (ingestion, post-call, evals) and the `eval` CLI |
| `apps/agent` | Python LiveKit Agents voice loop |
| `packages/shared` | Zod schemas: agent config, eval suites, events, queue names. Source of truth for contracts. |
| `packages/llm` | Model refs (`provider/model`) and fallback, in TS (`src/`) and Python (`python/`) |
| `agents/`, `evals/` | Example agent configs and eval suites |

## Commands

```bash
pnpm install && uv sync
pnpm infra:up                 # Postgres+pgvector, Redis, LiveKit dev
pnpm dev                      # web :3000 + worker
pnpm agent:dev                # Python agent
pnpm lint && pnpm typecheck && pnpm test
pnpm py:lint && pnpm py:test
pnpm format                   # Ultracite autofix
```

Run the relevant checks before calling work done.

## Code standards

General
- Smallest change that does the job. No speculative abstractions or unrelated cleanup.
- Match surrounding code. No code comments unless something is truly non-obvious.
- Validate at boundaries (YAML, HTTP, queue payloads, env) with Zod / Pydantic; trust types inside.
- Contracts live in `packages/shared`. When the agent config schema changes, run `pnpm --filter @answerline/shared generate:schema`, update the Pydantic mirror in `apps/agent/src/answerline_agent/config.py`, and add fixtures under `packages/shared/fixtures/agent-config/`. Parity tests in both languages fail on drift.
- Agent → worker call events go on the `call-events` BullMQ queue as `callEventJob` (`packages/shared/src/call-events.ts`, JSON Schema in `packages/shared/schema/call-event.schema.json`, fixtures in `packages/shared/fixtures/call-event/`). Job name = event `type`, job id = `callEventJobId` (`<room>_<type>[_<seq>]`; BullMQ rejects most ids containing `:`) so retries are idempotent. The Python producer validates against the same JSON Schema and fixtures.
- Never commit secrets. New env vars go in `.env.example`.
- Bug fixes get a regression test when practical.

TypeScript
- pnpm only. Internal packages are consumed as source (`exports` → `src/index.ts`); import with `.ts` extensions.
- Strict TS, `noUncheckedIndexedAccess`. No `any`; prefer `unknown` + parsing.
- [Ultracite](https://www.ultracite.ai/) (Biome preset) for lint and format; a lefthook pre-commit hook and a Claude Code hook run it automatically. Don't hand-format. Vendored shadcn files are excluded from lint.
- Tests: `node:test` + `tsx`, colocated as `*.test.ts`.

Web
- Use shadcn components from `@/components/ui` before writing new primitives. Add new ones with `pnpm dlx shadcn@latest add <name>` in `apps/web`, then `pnpm format`.
- Voice/call UI comes from LiveKit's Agents UI shadcn registry (`pnpm dlx shadcn@latest add @agents-ui/<name>` in `apps/web`, answer **no** to overwriting existing `ui/*` files). It lives in `components/agents-ui`, is excluded from lint, and has small patches for our Base UI components.
- Server Components by default; `"use client"` only where needed.
- API routes under `src/app/api/v1/`, validated with shared Zod schemas.

Python
- uv only. Python 3.13, Ruff (lint + format), pytest.
- Async throughout the call path. Nothing blocking in the agent's event loop.
- Provider construction goes through `answerline_agent.providers`; don't instantiate plugins elsewhere.

## Task workflow

Every change goes **issue → worktree → PR → merge**. No work starts without an issue, and nothing lands on `main` without a PR.
Use the `gh` CLI for all GitHub operations, including issues, pull requests, and project boards. Check `gh auth status` first; if authentication is expired, tell the user and stop GitHub operations until they reauthenticate. Do not silently switch to a browser or another connector. If a sandboxed `gh auth status` reports an invalid token, retry it in the host context before treating authentication as expired; the keyring login may still work there.

1. **Issue.** Start from a GitHub issue (roadmap issues are grouped by milestone, with sub-issues under parent issues). If none exists, open one first: imperative title, milestone, `roadmap` label. If the task needs a product or design decision, settle it with the user before coding and record the outcome on the issue (and in `tasks.md` Decisions).
2. **Worktree.** Lease a treehouse slot and branch from `origin/main`: `treehouse get -b <type>/<short-desc>` (or a Claude Code subagent with `isolation: "worktree"`). One issue per worktree; split work that touches shared contracts so the contract PR lands first (see "Parallel work").
3. **PR.** Run the checks (`pnpm lint && pnpm typecheck && pnpm test`, `pnpm py:lint && pnpm py:test`; load the slot `.env` so DB/Redis tests run), push, and open a PR into `main` with a Conventional Commit title and a body containing `Closes #N`, what changed, and exactly what was and wasn't tested. Bugs found along the way get their own issue or PR, not a drive-by fix.
4. **Merge.** When CI is green and the PR is reviewed: return the slot (`treehouse return <path>` / `pnpm wt:gc`), squash-merge with `gh pr merge --squash --delete-branch`, then rebase any other open branches on the new `main`. Issues close from `Closes #N`; close a parent issue once all its sub-issues are closed, and check the item off in `tasks.md`.

## Parallel work (worktrees)

Parallel tasks run in [treehouse](https://github.com/kunchenguid/treehouse) worktrees, never in the main checkout. The main checkout stays on `main` for review and merging.

- One task = one worktree = one branch = one PR. No stacked PRs.
- Each pool slot `N` is isolated on the shared compose stack: web `:300N`, database `answerline_wtN`, redis prefix `bull-wtN`, LiveKit agent `answerline-wtN`. `scripts/worktree-setup.sh` writes these into the slot's `.env` (copied from the main checkout via `.worktreeinclude`), installs deps, and migrates/seeds the slot database.
- Humans and CLI agents: `treehouse get -b <type>/<desc>` (or `pnpm wt`), work, push, open the PR, then `exit` to return the slot.
- Automation: `path=$(treehouse get --lease --lease-holder <name>)`, create the branch in `$path`, then `treehouse return <path>` when the PR is open.
- Claude Code worktree isolation (`isolation: "worktree"`, `--worktree`) leases slots through the `WorktreeCreate`/`WorktreeRemove` hooks in `.claude/settings.json`. Slots start on a detached `HEAD` at `origin/main`: create your branch first. Subagent slots are not returned automatically; run `pnpm wt:gc` to return leased Claude slots with no uncommitted or unpushed work.
- Return a slot (`treehouse return <path>` or `pnpm wt:gc`) before merging its PR: `gh pr merge --delete-branch` deletes the local branch and removes the worktree it is checked out in.
- Split parallel work by area. Shared contracts (`packages/shared`) and schema changes land first in their own PR. If two PRs add migrations, the later one regenerates its migration after rebasing.

## Git

- `main` is always green and deployable. Never commit directly to it; never force-push it.
- Branch per change: `<type>/<short-kebab-desc>`, e.g. `feat/web-call-button`, `fix/agent-fallback-timeout`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`
  - Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
  - Scopes: `web`, `worker`, `agent`, `shared`, `llm`, `infra`, `deps`, `repo` (omit if cross-cutting)
  - Subject: imperative, lowercase, no trailing period, ≤ 72 chars. Body explains *why*, wrapped at 72.
  - Breaking changes: `feat(shared)!: ...` plus a `BREAKING CHANGE:` footer.
- One logical change per commit; each commit should pass checks. Don't mix formatting churn with behavior changes.
- Open a PR into `main`; title uses the same Conventional Commit format. Squash-merge, delete the branch.
- Reference roadmap items or issues in the PR body (`tasks.md` milestone, `Closes #12`).
- Rebase on `main` to stay current; don't merge `main` into feature branches.
- Never commit `.env`, keys, recordings, or generated artifacts (`.next`, `dist`, `.venv`).

## Workflow

- Keep `README.md` claims honest: don't document features that don't exist without marking them as planned.
- Record unresolved design choices in the "Open decisions" section of `tasks.md`.
