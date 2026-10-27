# Contributing

## Local setup

Requirements: Node 24, pnpm 11, Python 3.13 with [uv](https://docs.astral.sh/uv/), Docker.

```bash
pnpm bootstrap     # prerequisites, .env, deps, infra, migrate + seed; safe to rerun
pnpm dev           # web on :3000 and worker
pnpm agent:dev     # Python voice agent
```

See the [README Quickstart](README.md#quickstart) for what bootstrap does and the equivalent manual steps.

Already running Postgres or Redis locally? Set `POSTGRES_PORT` / `REDIS_PORT` in `.env` and update `DATABASE_URL` / `REDIS_URL` to match.

Schema changes: edit `packages/db/src/schema.ts`, then `pnpm db:generate` and commit the migration.

## Parallel worktrees (optional)

Install [treehouse](https://github.com/kunchenguid/treehouse) and add its hooks to `~/.config/treehouse/config.toml` (treehouse ignores repo-level hooks for safety):

```toml
[hooks]
post_create = ["[ ! -x ./scripts/worktree-setup.sh ] || ./scripts/worktree-setup.sh"]
pre_destroy = ["[ ! -x ./scripts/worktree-teardown.sh ] || ./scripts/worktree-teardown.sh"]
```

Keep a plaintext `.env` in the main checkout (it is copied into each slot). Dotenvx loads each slot's root file after Turbo starts its tasks, preserving the slot's port, database, Redis prefix, and agent name. Do not encrypt the local file: setup and Docker Compose read it directly. See [environment configuration](docs/environment.md). Then `pnpm infra:up` once and `treehouse get -b feat/my-change` per task. See "Parallel work" in `AGENTS.md`.

## Per-session agent databases (optional)

With [PGX](https://github.com/pgrundev/pgx) installed (`pnpm add -g pgxdb`, Apple silicon or Linux, `pgx` on `PATH` or in `~/.local/bin`), every Claude Code session and subagent gets its own copy-on-write branch of `answerline_template`, with `DATABASE_URL` set for its shell. The hooks in `.claude/settings.json` do nothing when `pgx` is missing. One-time setup:

```bash
scripts/pgx-template.sh    # build answerline_template from migrations + seed; rerun after new migrations
```

Branches expire 2h after the last activity, or 10 minutes after the session ends (`.pgx.toml`). The session's `DATABASE_URL` wins over `.env`, so `pnpm test` and `pnpm db:migrate` inside a session hit its branch. Run `pgx agent doctor` if a session reports `PGX_ISOLATION=failed`. PGX is AGPL-3.0 and early (v0.1): use it for development and test databases only, never for real call data.

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm py:lint && pnpm py:test
```

## Layout

- `apps/web` Next.js dashboard and API
- `apps/worker` BullMQ jobs and the eval CLI
- `apps/agent` Python LiveKit voice agent
- `packages/shared` Zod schemas for agent configs, eval suites, and events
- `packages/db` Drizzle schema, migrations, and seed
- `packages/llm` Model refs and fallback routing (TypeScript in `src/`, Python in `python/`)
