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
