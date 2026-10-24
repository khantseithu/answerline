# Dashboard data contracts

M5 request and job boundaries live in `packages/shared/src/dashboard.ts`. Calls-list dates represent inclusive UTC calendar dates. Pagination starts at one, defaults to 25 rows, and permits at most 100 rows per page. Empty form filters should be omitted before parsing. Agent writes validate the complete config and require the last observed version for updates.

## Agent history

`agents.version` starts at one, including agents created before the migration. `agent_versions` stores immutable config snapshots keyed by agent and version. Creating an agent must save version one. Before an existing agent's first edit, save its current config as the baseline version if the snapshot does not exist. Update the agent and append the next snapshot in one transaction, rejecting stale versions with HTTP 409. User-facing history must never silently replace a prior snapshot.

## Usage and cost

`ModelUsage` rows identify the actual model and provider reported by the runtime, including fallback models. Missing attribution is recorded as unknown rather than assigned to the configured primary model. `call.ended.model_usage` is optional, so older producers remain valid. Existing aggregate `usage` fields are preserved.

| Stage | Unit | Quantity |
| --- | --- | --- |
| STT | `seconds` | Audio duration processed |
| LLM | `input_tokens` | Uncached input, excluding cached input and cache creation |
| LLM | `output_tokens` | Generated output tokens |
| LLM | `cached_input_tokens` | Cached input read tokens |
| LLM | `cache_creation_tokens` | Input tokens written to cache |
| TTS | `characters` | Characters synthesized |

Collectors must normalize provider-specific token totals before producing these rows. Inclusive input totals must not be charged again alongside cached tokens. Token and character counts are nonnegative integers; audio seconds may be fractional.

`calls.model_usage` stores these rows. `calls.cost_breakdown` adds `unitPriceUsd` and `costUsd` for each row. Rates are normalized to the row's unit. Unknown rates and costs are nullable. Missing usage or a positive quantity with an unknown rate must not produce a falsely complete zero-dollar total. Pricing estimates and their source dates belong to the cost calculator, not the call path.

## Call review and processing

`postCallJobSchema` requires both tenant and call IDs. Consumers must scope database reads and writes to both. `postCallAnalysisSchema` validates a bounded summary, an outcome tag, and sentiment before persistence.

Call records add sentiment and itemized costs without changing existing summaries, outcomes, or aggregate usage. `recording_started_at` on the ended event and `calls.recording_started_at` identify the recording's actual start time. Playback synchronization uses this origin rather than assuming recording began at call creation. Older recordings with no origin cannot claim precise synchronization.
