# Call tracing

Answerline can export voice-call traces to a self-hosted OpenTelemetry backend. Tracing is off unless an OTLP endpoint is configured. It does not require LiveKit Cloud or a hosted observability service.

## Start the local trace viewer

1. Run `docker compose --profile observability up -d jaeger`.
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in your local `.env`.
3. Start or restart the agent with `pnpm agent:dev`.
4. Make a web or SIP call, then end it.
5. Open `http://localhost:16686` and search for service `answerline-agent`.

The optional Compose profile uses Jaeger with in-memory storage for up to 10,000 traces. Traces disappear when the container restarts. Its UI and receiver bind to localhost. `JAEGER_UI_PORT` and `JAEGER_OTLP_PORT` change the published ports; update your exporter endpoint if you change the receiver port. A containerized agent on the Compose network uses `http://jaeger:4318` instead of localhost.

## Exporter settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Unset | Base HTTP endpoint; Answerline appends `/v1/traces` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Unset | Complete HTTP trace endpoint; takes precedence over the base endpoint |
| `OTEL_SERVICE_NAME` | `answerline-agent` | Service name in the trace viewer |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | `5` | Export request timeout in seconds |
| `OTEL_EXPORTER_OTLP_HEADERS` | Unset | Standard OTLP authentication headers, read by the exporter |

The exporter uses OTLP over HTTP with binary Protobuf, not gRPC. To disable it, unset both endpoint variables and restart the agent. The endpoint is validated at startup. Supply backend credentials through the environment and keep them out of configuration files committed to Git.

Spans are queued and exported by OpenTelemetry's batch processor on a background thread. Export failures are best effort and do not interrupt the call. On job shutdown, the agent requests a final flush outside the event loop, with a five-second flush budget. An unavailable backend can lose spans; traces are diagnostics, not the call record of truth.

## Trace contents

The LiveKit SDK supplies the `agent_session` call span and its `agent_turn`, `llm_node`, `tts_node`, and `function_tool` descendants. Answerline adds `stt_node` around the streaming transcription node. That span measures the STT stream lifetime, which can cover the whole call; use per-turn call metrics for transcription latency. LLM and TTS spans describe the individual generations. A call that never uses a tool has no tool-execution span.

Every exported span carries `answerline.room`, `answerline.tenant`, and `answerline.agent`. The room identifier links a trace to the call record. SDK provider and model attributes remain available where the provider reports them.

Answerline configures the SDK with `allow_pii=False`. Conversation text, system instructions, tool arguments and results, and marked sensitive SDK attributes are stripped before reaching the exporter. Free-form exception details are also redacted. Traces still contain operational identifiers, tool names, model names, and timings. Restrict backend access and choose retention appropriate for that metadata. This setting applies to Answerline's OTLP exporter; any independently configured LiveKit Cloud capture follows the Cloud project's settings.

This integration traces the live Python voice session. It does not propagate trace context through BullMQ or instrument the dashboard and worker processes.

## Verify an exporter change

`uv run pytest apps/agent/tests/test_telemetry.py` runs a real SDK session with local model/audio substitutes, sends its spans through the OTLP HTTP exporter to a local receiver, and verifies the session-to-stage hierarchy and content filtering. It also checks disabled configuration and that shutdown flushing runs outside the event loop. These checks need no provider keys or cloud account.

References: [LiveKit OpenTelemetry tracing](https://docs.livekit.io/testing/observability/tracing/) and [Jaeger deployment](https://www.jaegertracing.io/docs/latest/deployment/).
