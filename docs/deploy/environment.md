# Environment reference

`.env.example` lists the development values and optional settings.
`.env.production.example` contains the required production inputs; copy it to
`.env.production` and fill the empty credentials before starting production.
Keep secret environment files out of Git. Use `openssl rand -hex 32` for generated
secrets and a URL-safe Postgres password.

## Files and precedence

Local Node commands load the root `.env` through dotenvx. `pnpm agent:dev` also
loads that file before launching Python. Existing process environment values
take precedence. Python settings read the process environment; launching
`uv run answerline-agent` alone does not load the root `.env`.

Production commands select the file explicitly:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --wait
```

Compose interpolates variables from the shell and the selected file, with shell
values taking precedence. App containers also receive `ANSWERLINE_ENV_FILE`
(default `.env.production`) through `env_file`. If you select another filename,
set `ANSWERLINE_ENV_FILE` to that same file. A container's explicit `environment`
entries override `env_file` values. Production Compose supplies internal database,
Redis, agent-directory, knowledge-directory, and health-port values; it derives
public URLs from the configured domains. The agent, SIP, and Egress connect to
LiveKit privately, while the web service advertises the public signaling URL.

Omit optional variables instead of setting them to an empty string. Blank numeric,
URL, OAuth, or nonempty-string settings can fail validation. Empty provider-key
placeholders are usable only until a stage requiring that provider runs. YAML
files do not expand environment variables by themselves; Compose generates the
LiveKit, SIP, and Egress configuration bodies.

## Production deployment

| Variable | Meaning and default |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | Compose service/volume namespace. Production example: `answerline-production`; development otherwise uses the checkout directory name. Keep it stable to reuse persisted volumes. |
| `APP_DOMAIN` | Dashboard hostname, without scheme or path. Required in production; Caddy serves HTTPS and the auth URL derives from it. |
| `LIVEKIT_DOMAIN` | Public LiveKit hostname, without scheme or path. Required in production. |
| `TURN_DOMAIN` | Separate TURN hostname. Required in production; all three domain records point to the deployment's public address. |
| `POSTGRES_PASSWORD` | Required production database password. Use URL-safe hex because Compose embeds it in `DATABASE_URL`. |
| `ANSWERLINE_ENV_FILE` | Container `env_file` path. Default `.env.production`; match the file passed to `--env-file`. |
| `ANSWERLINE_IMAGE_REGISTRY` | Image prefix. Default `ghcr.io/khantseithu/answerline`; Compose appends `/web`, `/worker`, and `/agent`. |
| `ANSWERLINE_VERSION` | Image tag. Default `latest`; pin a published tag when pulling images. Source builds use the checked-out code. See [image publishing](images.md). |
| `HTTP_PORT`, `HTTPS_PORT` | Host Caddy ports, default 80/443. Keep these defaults for production certificate issuance and TURN/TLS; alternate values are for isolated local testing. |

`config --quiet` checks Compose interpolation and required nonempty inputs. It
does not validate provider credentials, DNS, TLS issuance, SIP reachability, or
media traversal. LiveKit API secrets must be at least 32 characters; generate
independent values for auth, LiveKit, and Postgres. Configure external recording
storage and provider keys before making calls.

## Application, authentication, and storage

| Variable | Meaning and default |
| --- | --- |
| `NODE_ENV` | Next.js runtime mode: `development`, `test`, or `production`. Let Next.js commands select it locally; the web image sets production mode. |
| `PORT` | Local web port, default 3000. The production web container always listens on 3000 behind Caddy. |
| `POSTGRES_PORT`, `REDIS_PORT` | Development host ports, default 5432/6379. Production does not publish these services. |
| `DATABASE_URL` | Postgres URL. Required for persistent app/worker operations. Production sets the internal `postgres:5432` URL from its password. |
| `REDIS_URL` | Default `redis://localhost:6379` locally; production sets `redis://redis:6379`. |
| `REDIS_PREFIX` | BullMQ namespace, default `bull`. Match it across agent, worker, and web. Production sets `bull`; worktree slots use separate prefixes. |
| `WORKER_HEALTH_PORT` | Optional local worker readiness HTTP port, 1–65535. Production sets 8080 privately. Omit it to disable the local listener. |
| `ADMIN_EMAIL` | Initial administrator address. Development default `admin@answerline.local`; production requires an explicit address. |
| `ADMIN_PASSWORD` | Initial administrator password, 12–128 characters. Production requires it. Local `admin:init` generates a password if omitted and saves it in `.data/admin-credentials`. Reruns preserve an existing account. |
| `ADMIN_EMAIL_VERIFIED` | `true` or `false`, default `false`, for the initial administrator. |
| `BETTER_AUTH_URL` | Public dashboard origin, local default `http://localhost:3000`. Production derives `https://<APP_DOMAIN>`. |
| `BETTER_AUTH_SECRET` | Auth secret, at least 32 characters. Production requires it; local `admin:init` generates and persists one if omitted. Preserve it across restarts and restores. |
| `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET` | Optional GitHub OAuth pair; set both or omit both. Configure the callback URL for the dashboard's public origin. |
| `TENANT` | Single-workspace tenant slug, default `default`. Startup seeds the default tenant; changing this value does not create another tenant. |
| `AGENT_NAME` | LiveKit worker dispatch name, default `answerline`. Match web/phone dispatch and the Python worker. |
| `AGENTS_DIR` | Local YAML directory, example `agents`. Production sets `/app/agents`; image templates are packaged at build time. |
| `DEFAULT_AGENT` | Agent slug used when call metadata does not select one, default `bright-smile-dental`. |
| `KNOWLEDGE_FILES_DIR` | Uploaded-source directory, default repository `.data/knowledge`. Production shares `/app/.data/knowledge` between web and worker through a persistent volume. |
| `S3_ENDPOINT` | Browser-reachable S3 API endpoint for private playback signing. Local example `http://localhost:9000`; omit for AWS S3. |
| `S3_EGRESS_ENDPOINT` | Upload endpoint reachable from Egress. Development default `http://minio:9000`; required in production. It must address the same store/bucket as `S3_ENDPOINT`. |
| `S3_REGION` | Bucket region. Local/web default `us-east-1`; production example/default `auto` for R2. Set the actual region for AWS or another provider. |
| `S3_BUCKET` | Recording bucket, default `recordings`. Match the agent's stored locations, web signing, and Egress uploads. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | S3 API credentials. Required in production; development examples are local MinIO credentials only. |
| `MINIO_API_PORT`, `MINIO_CONSOLE_PORT` | Development-only host ports, default 9000/9001. Production Compose has no MinIO service. |

Recording remains opt-in in each agent configuration. See
[recording storage](recordings.md) for R2, other S3 providers, and bucket migration
constraints, and [backup/restore](backups.md) for persistent state.

## LiveKit, SIP, and firewall ports

| Variable | Meaning and default |
| --- | --- |
| `LIVEKIT_URL` | Local default `ws://localhost:7880`. Production web/CLI uses `wss://<LIVEKIT_DOMAIN>`; agent/SIP/Egress use private signaling. |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Matching credentials across LiveKit and all clients. Development uses `devkey`/`secret`; replace both in production. |
| `LIVEKIT_TCP_PORT` | Production direct ICE/TCP port, default 7881. Host/container ports match. |
| `LIVEKIT_RTC_PORT_START`, `LIVEKIT_RTC_PORT_END` | Production ICE/UDP range, default 50000–50100, forwarded unchanged. Development uses UDP mux port 7882 instead. |
| `LIVEKIT_TURN_UDP_PORT` | Production TURN/UDP port, default 3478. TURN/TLS shares public TCP 443 through Caddy. |
| `SIP_PORT` | Production SIP signaling TCP/UDP port, default 5060. Development publishes 5060. |
| `SIP_PUBLIC_IP` | Public IPv4 advertised by SIP. Required in production; optional for local development. Also the phone setup CLI's default SIP host. |
| `SIP_RTP_PORT_START`, `SIP_RTP_PORT_END` | SIP audio UDP range, default 10000–10100. Separate from LiveKit's RTC range. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Required only for Twilio phone-number setup through the SIP CLI. |
| `TELNYX_API_KEY` | Required only for Telnyx phone-number setup through the SIP CLI. |

Open the configured public ports in both host and cloud firewalls. WebSocket
connectivity alone does not prove audio works. See [LiveKit setup](livekit.md).

## Model providers and background analysis

| Variable | Meaning and default |
| --- | --- |
| `DEEPGRAM_API_KEY` | STT key for the currently supported Deepgram voice provider. |
| `CARTESIA_API_KEY` | TTS key for the currently supported Cartesia voice provider. |
| `ANTHROPIC_API_KEY` | Anthropic LLM key, required when selected by an agent, eval, or post-call model. |
| `OPENAI_API_KEY` | OpenAI LLM/embedding key when selected. |
| `GOOGLE_API_KEY` | Google LLM/embedding key when selected; required for the default embedding model. |
| `DEEPSEEK_API_KEY` | DeepSeek LLM key when selected. |
| `OPENROUTER_API_KEY` | OpenRouter LLM key when selected. |
| `EMBEDDING_MODEL` | Provider/model reference, default `google/gemini-embedding-2`. Supported embedding providers: Google, OpenAI, Ollama. Keep ingestion and retrieval on the same embedding model; reingest after changing it. |
| `OLLAMA_BASE_URL` | Ollama service endpoint for live-call LLMs, embeddings, and worker post-call analysis, default `http://localhost:11434`. Use the service root without `/v1` when sharing it with embeddings. A host's localhost is not the agent/worker container's localhost. |
| `POST_CALL_MODEL` | Optional provider/model override for summaries, outcome, and sentiment. If omitted, the worker uses the agent's LLM primary/fallback chain. |
| `COST_PRICES_JSON` | Optional JSON array of price overrides with `stage`, `provider`, `model`, `unit`, and `unitPriceUsd`. The example file shows the format. |

The sample agent uses Deepgram, Cartesia, and an OpenRouter primary LLM with
OpenAI and Google fallbacks. Supply the corresponding keys, or change its model configuration
to providers you configure. Setting a key does not select a model; model refs
live in agent YAML/dashboard configuration. Ollama does not require an API key.

## Call behavior

These values configure the Python voice loop. Times are in seconds.

| Variable | Default and behavior |
| --- | --- |
| `TURN_DETECTION` | `local`; modes `local`, `cloud`, `stt`, `vad`. Local uses the bundled `v1-mini` detector; cloud selects the hosted `v1` detector. |
| `INTERRUPTION_MODE` | `vad`; modes `vad`, `adaptive`. |
| `MAX_CALL_DURATION_SECONDS` | 900; zero disables the duration limit. |
| `IDLE_TIMEOUT_SECONDS` | 60; zero disables idle checking. |
| `DRAIN_TIMEOUT_SECONDS` | Optional override. Otherwise max call duration +120, or 3600 when duration is unlimited. If increasing it, also increase the production agent's 20-minute `stop_grace_period`. |
| `TOOL_TIMEOUT_SECONDS` | 10; positive timeout for a configured tool call. |
| `TOOL_RETRIES` | 1; allowed range 0–3. |
| `TOOL_FILLER_DELAY_SECONDS` | 0.8; nonnegative delay before a tool filler message. |
| `KNOWLEDGE_SEARCH_TIMEOUT_SECONDS` | 1.5; positive search timeout. |
| `KNOWLEDGE_SEARCH_TOP_K` | 4; allowed range 1–10. |
| `KNOWLEDGE_MIN_SIMILARITY` | Optional vector similarity cutoff, between -1 and 1. |
| `KNOWLEDGE_MIN_KEYWORD_TERMS` | 2; lexical fallback threshold when `KNOWLEDGE_MIN_SIMILARITY` is set. Range 1–10, capped at the query's term count. |
| `CALL_WRAP_UP_MESSAGE` | Optional replacement for the duration-limit closing message. |
| `IDLE_CHECK_IN_MESSAGE` | Optional replacement for the idle check-in question. |
| `AFTER_HOURS_VOICEMAIL_MESSAGE` | Optional after-hours voicemail message; supports `{name}`. |
| `AFTER_HOURS_TRANSFER_MESSAGE` | Optional after-hours transfer message; supports `{name}`. |
| `AFTER_HOURS_TRANSFER_FAILED_MESSAGE` | Optional message when that transfer fails. |

## Tracing and local observability

| Variable | Meaning and default |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional OTLP HTTP base endpoint; agent appends `/v1/traces`. Omit both endpoint settings to disable application tracing. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Optional full traces endpoint; takes precedence over the base endpoint. |
| `OTEL_SERVICE_NAME` | Agent service name, default `answerline-agent`. |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | Positive HTTP exporter timeout, default 5 seconds. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Optional standard OpenTelemetry exporter authentication headers. |
| `JAEGER_UI_PORT`, `JAEGER_OTLP_PORT` | Development observability profile's loopback ports, default 16686/4318. Production does not start Jaeger. |

In containers, use a collector endpoint reachable from the container network;
`localhost:4318` points back to that container. Provider/model SDKs may support
additional environment settings; this reference covers Answerline's configuration
and the credentials used by its configured adapters.
