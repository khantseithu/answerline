# Answerline Tasks

Working backward from the [README](README.md). Each milestone maps to a roadmap item and ends with something demoable. Check items off as they land.

Legend: `[x]` done · `[ ]` todo · **Done when** = acceptance criteria for the milestone.

---

## M0. Foundation

- [x] pnpm + Turborepo workspace (`apps/web`, `apps/worker`, `packages/shared`, `packages/llm`)
- [x] uv workspace (`apps/agent`, `packages/llm/python`)
- [x] Biome (TS) and Ruff (Python) lint/format
- [x] Zod schemas: agent config, eval suite, events, queue names
- [x] `packages/llm` model refs and fallback (TS + Python)
  - [x] OpenRouter LLM provider (`openrouter/<vendor>/<model>` refs) (#209)
- [x] docker compose: Postgres (pgvector), Redis, LiveKit dev server
- [x] Next.js 16 + Tailwind 4 + shadcn/ui (Base UI, all components)
- [x] Python agent skeleton: loads YAML, builds STT / LLM fallback / TTS, greets
- [x] Database
  - [x] Pick ORM/migrations for TS side (Drizzle recommended) and add `packages/db`
  - [x] Initial schema: `tenants`, `users`, `agents`, `calls`, `call_turns`, `tool_calls`, `knowledge_sources`, `knowledge_chunks` (with `vector` column), `bookings`, `eval_runs`, `eval_results`, `api_keys`, `webhooks`, `webhook_deliveries`
  - [x] Enable `vector` extension in a migration
  - [x] `pnpm db:migrate`, `pnpm db:studio`, seed script that loads `agents/*.yaml`
  - [x] Python read access for the agent (asyncpg or SQLAlchemy core, no second migration system)
- [x] Config
  - [x] Typed env loading for web/worker (zod) and agent (pydantic-settings)
  - [x] Shared Python mirror of agent config schema stays in sync with Zod (generate JSON Schema from Zod, test Python model against it)
- [x] CI (GitHub Actions)
  - [x] JS: install, lint, typecheck, test, web build
  - [x] Python: uv sync, ruff, pytest
  - [ ] Turbo remote cache (optional)
- [x] Repo hygiene: `CLAUDE.md`/`AGENTS.md` for the root, PR template, issue templates, Renovate or Dependabot

**Done when:** fresh clone → `pnpm install && uv sync && pnpm infra:up && pnpm db:migrate` works and CI is green on `main`.

---

## M1. Web voice calls with a sample agent

Roadmap: *Web voice calls with a sample agent*

- [x] Agent
  - [x] Agent dispatch by agent ID (room metadata or dispatch metadata → load config from DB, fall back to YAML)
  - [x] Turn detection model (LiveKit `inference.TurnDetector` or self-hosted alternative; verify it runs without LiveKit Cloud)
  - [x] Interruption handling and false-interruption tuning
  - [ ] Noise cancellation (optional, check licensing for self-hosted): deferred to backlog, see #21
  - [x] Emit `call.started` / `call.ended` to Redis (BullMQ-compatible enqueue from Python, or a thin HTTP endpoint on web)
  - [x] Persist transcript turns with timestamps
  - [x] Graceful shutdown and max call duration
- [x] Web
  - [x] `POST /api/v1/token` issuing LiveKit access tokens for a room + agent dispatch
  - [x] **Talk to agent** button: connect, mic permission, live transcript, hang up (`@livekit/components-react`)
  - [x] Agent state indicator (listening / thinking / speaking) and audio visualizer
- [x] Recording: LiveKit Egress to local disk or S3-compatible storage, link recording to call
- [x] Docs: `docs/architecture.md` first pass

**Done when:** from `localhost:3000`, click **Talk to agent**, hold a natural conversation with Bright Smile Dental, and see the transcript saved in Postgres.

---

## M2. Knowledge base ingestion and hybrid search

Roadmap: *Knowledge base ingestion and hybrid search*

- [x] Ingestion (worker, `ingestion` queue)
  - [x] Loaders: PDF, URL (fetch + readability), Q&A pairs, plain text/Markdown
  - [x] Chunking with overlap and source metadata
  - [x] Embeddings via pluggable provider (OpenAI, Gemini, Ollama) (#34)
  - [x] Gemini Embedding 2 as the default embedding model (#212)
  - [x] Ingestion retries rate-limited embedding requests (HTTP 429/503) and splits batches (#218)
  - [x] Store chunks + embeddings + `tsvector` in Postgres
  - [x] Re-ingest on change (content hash), delete stale chunks
  - [x] Job status and errors visible to the dashboard
- [ ] Retrieval
  - [x] Hybrid search: pgvector cosine + Postgres full-text, merged with reciprocal rank fusion
  - [ ] Optional reranker (Cohere, Jina, or local cross-encoder): deferred until live-embedding metrics show a need (#40)
  - [x] Agent tool `search_knowledge` with a strict latency budget (target p95 < 300 ms)
  - [x] Cite source in transcript/tool call log (tool call log, #42)
  - [x] Relevance signal so out-of-scope queries don't return confident hits (#180)
- [x] Dashboard: knowledge page (add URL, upload file, add Q&A, status, re-sync, delete)
- [x] Tests: retrieval quality fixtures for the dental FAQ
- [x] CI runs the Python Postgres/Redis tests (#183)

**Done when:** upload the sample FAQ PDF, ask the agent about opening hours/services, and get correct answers grounded in the KB.

---

## M3. Built-in tools: booking, transfer, business hours

Roadmap: *Built-in tools: booking, transfer, business hours*

- [x] Tool framework (#45)
  - [x] Map `tools:` config to LiveKit function tools (#46); `business_hours` is the first supported configured tool
  - [x] Log every tool call (args, result, latency, error) to `tool_calls` (#47, pulled forward for #42)
  - [x] Timeouts, retries, and spoken filler while a tool runs (#48)
- [ ] `business_hours`: timezone-aware open/closed, holidays, `after_hours` behavior (voicemail / transfer / answer)
  - [x] Opt-in lookup: timezone-aware weekday/weekend schedules, overnight hours, and configured after-hours policy (#46)
  - [x] Holiday and after-hours config contract (#229)
  - [ ] Holiday overrides and automatic after-hours routing (#49)
- [ ] `book_appointment` (#50)
  - [x] Provider interface: availability lookup, create, cancel (#51)
  - [x] Native provider: slots from `hours`, bookings stored in Postgres without double-booking (#205)
  - [x] Confirm details back to caller before booking (#55)
  - [ ] Emit `booking.created`
  - [ ] Cal.com adapter (optional, #53)
  - [ ] Google Calendar adapter (optional, #54)
- [x] `capture_lead`: name, phone, reason → `leads` table + event (#57)
  - [x] Lead storage and validated `lead.created` queue contract (#197)
  - [x] Capture tool and worker persistence (#57)
- [ ] `transfer_call`: cold transfer (SIP REFER) and warm transfer (agent briefs human, then bridges); web calls fall back to message capture
  - [x] `transfer_call` config contract with a validated `to` target (#229)
  - [x] Cold transfer via SIP REFER; web calls fall back to voicemail (#58)
  - [ ] Warm transfer (#226)
- [ ] Voicemail: record message, transcribe, attach to call
  - [x] `voicemails` storage and validated `voicemail.created` queue contract (#229)
  - [ ] Voicemail tool and worker persistence (#59)
- [ ] HTTP tools from config: templated URL/body, headers from secrets, JSON schema for params, response truncation
- [ ] MCP servers: connect via `mcp_servers` on `AgentSession`, per-agent allowlist
- [ ] Composio customer-support tools (deferred): optional integration for helpdesk tickets, customer context, and escalations via [Composio](https://composio.dev/product/composio-for-customer-support); implement after the core tool framework ([#186](https://github.com/khantseithu/answerline/issues/186))
- [ ] Secrets: per-tenant encrypted secret store referenced from config (`{{secrets.CAL_API_KEY}}`)

**Done when:** a caller can book an open slot that Answerline stores without double-booking, ask if the clinic is open, and get transferred or sent to voicemail after hours.

---

## M4. Phone calls over SIP

Roadmap: *Phone calls over SIP*

- [ ] Add LiveKit SIP service to docker compose (with Redis)
- [ ] Inbound trunk + dispatch rule per phone number → agent
- [ ] Twilio guide and setup script
- [ ] Telnyx guide and setup script
- [ ] Generic SIP trunk guide
- [ ] Caller ID captured on call record
- [ ] DTMF handling (optional menu, extension entry)
- [ ] Phone numbers page in dashboard (assign number to agent)
- [ ] `docs/telephony.md` ("Connect a phone number")

**Done when:** calling a real Twilio number reaches the agent, and the call shows up in the call list with caller ID.

---

## M5. Dashboard: calls, transcripts, cost per call

Roadmap: *Dashboard: calls, transcripts, cost per call*

- [ ] Auth
  - [ ] Better Auth (#128): email/password + optional OAuth
  - [ ] First-run admin account printed in logs (per README quickstart)
- [x] App shell: sidebar (Calls, Agents, Knowledge, Evals, Phone numbers, Settings), dark mode
- [ ] Calls list: filters (agent, date, channel, outcome), search transcripts, pagination
- [ ] Call detail: transcript with timestamps, audio player synced to transcript, tool calls timeline, latency per turn (STT / LLM TTFT / TTS TTFB), cost breakdown
- [ ] Post-call job (worker, `post-call` queue): summary, outcome tag, sentiment, cost calculation
- [ ] Cost tracking: price table per provider/model (STT per min, LLM per token, TTS per char), usage captured from LiveKit metrics
- [ ] Agents page: list, create from template, edit (form + raw YAML editor with Zod validation), version history
- [ ] Overview page: calls today, avg duration, cost, bookings, failure rate
- [ ] OpenTelemetry: traces from call → STT/LLM/TTS/tool spans, OTLP exporter config, optional Jaeger in compose

**Done when:** after a few test calls, the dashboard shows each call with transcript, recording, tool calls, latency, and cost.

---

## M6. Evals runner

Roadmap: *Evals runner*

- [ ] Text-mode eval harness: run the agent's LLM + tools against scripted caller turns without audio (LiveKit Agents testing utilities)
- [ ] Multi-turn scripts (array of caller turns), mocked tools by default with opt-in live tools
- [ ] Assertions: `tool_called`, `tool_args`, `mentions`, `not_mentions`, `judge` (LLM-as-judge with rubric)
- [ ] Metrics per run: pass rate, latency, cost; per-case result with transcript
- [ ] CLI: `worker eval agents/<name>.yaml` (current stub) with exit code for CI, `--model` override for comparisons
- [ ] Queue-backed runs from dashboard; Evals page with run history and diff between runs
- [ ] Optional audio-mode evals (TTS caller → full pipeline) for latency realism
- [ ] GitHub Action example: run evals on PRs that change `agents/` or `evals/`

**Done when:** `docker compose run --rm worker eval agents/bright-smile-dental.yaml` prints pass rate, latency, and cost, and the same run appears in the dashboard.

---

## M7. Docker Compose and Coolify deploys

Roadmap: *Docker Compose and Coolify deploys*

- [ ] Dockerfiles: `apps/web` (Next.js standalone), `apps/worker`, `apps/agent` (uv, model weights pre-downloaded)
- [ ] Full `docker-compose.yml`: web, worker, agent, Postgres, Redis, LiveKit, LiveKit SIP, Egress, with healthchecks and migrations on start
- [ ] Production LiveKit config (keys, TURN, UDP port range, domain/TLS notes)
- [ ] `.env.example` complete and documented
- [ ] Recording storage: Cloudflare R2 as the primary target, with an adapter for other S3-compatible providers ([#153](https://github.com/khantseithu/answerline/issues/153))
- [ ] Images published to GHCR on tag (multi-arch)
- [ ] `docs/deploy/docker.md`
- [ ] Coolify template + `docs/deploy/coolify.md`
- [ ] Backup/restore notes for Postgres and recordings

**Done when:** the README Quickstart works verbatim on a fresh VPS.

---

## M8. Terraform modules for Azure and AWS

Roadmap: *Terraform modules for Azure and AWS*

- [ ] `infra/azure`: Container Apps (web, worker, agent), Postgres Flexible Server with pgvector, Azure Cache for Redis, Key Vault, Cloudflare R2 for recordings, autoscaling for worker/agent
- [ ] `infra/aws`: ECS Fargate (or EKS), RDS Postgres, ElastiCache, Secrets Manager, S3
- [ ] LiveKit: self-hosted on VMs/EC2 with UDP, or LiveKit Cloud as documented option
- [ ] Environments: dev, staging, prod via workspaces or separate state
- [ ] GitHub Actions: build images → deploy dev → promote to staging → prod with approval
- [ ] Remote state + OIDC auth to cloud providers (no long-lived keys)

**Done when:** `terraform apply` in `infra/azure/envs/dev` produces a working stack, and a tag promotes the same image to prod.

---

## M9. Multi-tenant workspaces and API keys

Roadmap: *Multi-tenant workspaces and API keys*

- [ ] Tenant scoping on every table and query (consider Postgres RLS)
- [ ] Workspaces: create, switch, invite members, roles (owner, admin, viewer)
- [ ] API keys: create, scope, hash at rest, last used, revoke
- [ ] REST API v1: calls (list, get), agents (CRUD), knowledge (CRUD), evals (run, get)
- [ ] OpenAPI spec generated from Zod, served at `/api/docs`
- [ ] Rate limiting per key (Redis)
- [ ] Per-tenant provider keys and usage limits

**Done when:** two workspaces run separate agents from one deployment with no data leaking across them, and the README `curl` examples work.

---

## M10. Outbound calls and webhooks

Roadmap: *Outbound calls and webhooks*

- [ ] Outbound SIP trunk config
- [ ] `POST /api/v1/calls` starts an outbound call (create room, dispatch agent, create SIP participant)
- [ ] Outbound-specific config: first message, voicemail detection (AMD), retry policy, calling-hours guard
- [ ] Webhooks: endpoints per workspace, event subscriptions, HMAC signatures, retries with backoff, delivery log and replay
- [ ] Events: `call.started`, `call.ended`, `booking.created` (+ `lead.created`, `eval.completed`)

**Done when:** the README outbound `curl` places a real call, and a webhook receiver gets signed `call.ended` with the transcript URL.

---

## M11. Multilingual agents

Roadmap: *Multilingual agents*

- [ ] `language` drives STT, TTS voice, and turn-detection model choice
- [ ] Auto language detection with per-call switching
- [ ] Per-language greetings and instructions
- [ ] Multilingual KB retrieval (multilingual embeddings)
- [ ] Eval suites in at least two non-English languages

**Done when:** the dental agent handles a full Spanish call, including a booking.

---

## Launch

- [ ] Hosted demo at `demo.answerline.dev` (browser + phone number), with abuse limits (call length, rate limits)
- [x] Adopt the Signal “a” identity, publish reusable brand assets, and update site branding (#192)
- [ ] 2-minute demo video and `docs/assets/demo-thumbnail.png`
- [x] 45-second launch preview video in the README, captioned as the v1 vision (#202); inline GitHub video player (#214)
- [ ] Docs: `architecture.md`, `telephony.md`, deploy guides, configuration reference, tools reference
- [ ] Make repo public, add topics, social preview image
- [ ] Security: dependency audit, secret scanning, `SECURITY.md`

---

## Decisions

- Default agent primary LLM: `openrouter/recursive/flint-v1.0:free` through OpenRouter (replaces Google Gemini 3.8 Flash); retain the existing fallback chain (#216, #222)

- Brand: adopt the Signal “a” identity selected from the logo concepts; keep outlined mark, wordmark, light/dark variants, and app icons in `brand/` (#192)
- ORM and migrations: Drizzle with postgres.js (#127)
- Agent events: the Python agent enqueues BullMQ jobs directly; the worker consumes them (#129)
- Agent config source of truth: the database; `agents/*.yaml` is the seed/import format and fallback (#131)
- Recording storage: Cloudflare R2 is the primary production target; other S3-compatible providers use an adapter. Local compose uses MinIO for development; recording is opt-in per agent (#132, #153)
- M2 embeddings: `google/gemini-embedding-2` by default (was OpenAI); every provider uses 1536-dimensional vectors to fit `knowledge_chunks.embedding vector(1536)`. Gemini Embedding 2 has no `taskType`, so the provider prefixes the text: `task: search result | query:` for agent queries, `title: none | text:` for ingested chunks. Switching models requires re-ingesting sources (#34, #212)
- Auth: Better Auth (#128)
- Knowledge relevance floor: `hybrid_search` returns absolute signals (cosine similarity, matched query terms) and the tool applies an optional `KNOWLEDGE_MIN_SIMILARITY`, off by default because similarity scales differ per embedding model; a keyword match counts as strong only when it covers at least `KNOWLEDGE_MIN_KEYWORD_TERMS` (default 2) distinct query terms (#180)
- Booking: a minimal native provider ships first instead of Cal.com, which few target businesses use. Slots come from the agent's `hours` at a fixed length, bookings live in Postgres with an exclusion constraint against overlaps, and the agent writes bookings directly so it only confirms what was stored (an exception to #129). Cal.com and Google Calendar are optional adapters (#50, #205)
- Booking providers: a Python `BookingProvider` protocol (availability, create, cancel) behind a registry keyed by the `book_appointment` `provider` name; the tool takes its timezone from `hours`, and callers can cancel only bookings made earlier in the same call. Cross-call cancellation is deferred (#51)
- Booking confirmation: `book_appointment` only prepares a booking; `confirm_booking` writes it and is refused until the caller has spoken after the read-back, so the model cannot book in the same breath as summarizing (#55)
- OpenRouter model refs: `openrouter/<vendor>/<model>` (e.g. `openrouter/anthropic/claude-sonnet-4.5`). The model ref pattern allows one optional extra `/` segment so OpenRouter's own ids pass unchanged; the provider is everything before the first `/` (#209)
- After-hours routing: decided at call start from `hours` plus `hours.holidays` (`{date, hours?, name?}`; no `hours` means closed all day). Closed with `voicemail` takes a message; `transfer` transfers immediately (web calls fall back to voicemail); `answer` answers normally with the agent told it is closed (#49)
- Transfer: the MVP ships cold transfer only, via LiveKit `transfer_sip_participant` (SIP REFER) to `transfer_call.to` (E.164 or `sip:` URI); web calls fall back to voicemail. Warm transfer is #226 (#58)
- Voicemail: the agent takes the message and the STT transcript is stored in `voicemails` via a `voicemail.created` event, linked to the call. Audio is the call recording when recording is enabled; no per-voicemail clip (#59)

## Open decisions

- Turn detection for fully self-hosted setups: the agent defaults to the bundled `inference.TurnDetector(version="v1-mini")` with VAD interruption; Cloud `v1` and adaptive interruption are opt-in. Deferred: revisit on real phone calls in M4 (#130)
- Model alias names in README (`claude-sonnet`, `gpt-mini`) vs full model IDs (#133)
