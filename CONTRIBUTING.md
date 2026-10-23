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

Keep a `.env` in the main checkout (it is copied into each slot). Then `pnpm infra:up` once and `treehouse get -b feat/my-change` per task. See "Parallel work" in `AGENTS.md`.

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
