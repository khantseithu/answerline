# Contributing

## Local setup

Requirements: Node 24, pnpm 11, Python 3.13 with [uv](https://docs.astral.sh/uv/), Docker.

```bash
pnpm install
uv sync
cp .env.example .env
pnpm infra:up      # Postgres (pgvector), Redis, LiveKit dev server
pnpm db:migrate
pnpm db:seed       # default tenant + agents/*.yaml
pnpm dev           # web on :3000 and worker
pnpm agent:dev     # Python voice agent
```

Already running Postgres or Redis locally? Set `POSTGRES_PORT` / `REDIS_PORT` in `.env` and update `DATABASE_URL` / `REDIS_URL` to match.

Schema changes: edit `packages/db/src/schema.ts`, then `pnpm db:generate` and commit the migration.

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
