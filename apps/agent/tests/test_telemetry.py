import asyncio
import gzip
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from queue import SimpleQueue

import pytest
from answerline_agent import telemetry
from answerline_agent.settings import Settings
from answerline_agent.telemetry import TracedAgent, configure_tracing, flush_tracing
from livekit import rtc
from livekit.agents import AgentSession, TurnHandlingOptions, llm, stt
from livekit.agents.telemetry import set_tracer_provider, tracer
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS
from livekit.agents.voice import io
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.trace import NoOpTracerProvider
from pydantic import ValidationError


class LocalInput(io.AudioInput):
    def __init__(self):
        super().__init__(label="test input")
        self.sent = False

    async def __anext__(self):
        if self.sent:
            raise StopAsyncIteration
        self.sent = True
        return rtc.AudioFrame.create(sample_rate=16000, num_channels=1, samples_per_channel=160)


class LocalOutput(io.AudioOutput):
    def __init__(self):
        super().__init__(
            label="test output",
            sample_rate=24000,
            capabilities=io.AudioOutputCapabilities(pause=False),
        )

    async def capture_frame(self, frame):
        await super().capture_frame(frame)

    def clear_buffer(self):
        self.on_playback_finished(playback_position=0, interrupted=True)

    def flush(self):
        self.on_playback_finished(playback_position=0, interrupted=False)


class LocalLLM(llm.LLM):
    def chat(self, **kwargs):
        raise AssertionError("The test agent supplies its own model node")


class LocalSTT(stt.STT):
    def __init__(self):
        super().__init__(capabilities=stt.STTCapabilities(streaming=True, interim_results=False))
        self.received = asyncio.Event()

    async def _recognize_impl(self, buffer, *, language, conn_options):
        raise AssertionError("The test recognizer only streams")

    def stream(self, *, language=None, conn_options=DEFAULT_API_CONNECT_OPTIONS):
        return LocalSTTStream(stt=self, conn_options=conn_options)


class LocalSTTStream(stt.SpeechStream):
    async def _run(self):
        async for _frame in self._input_ch:
            self._stt.received.set()


class LocalAgent(TracedAgent):
    def __init__(self):
        super().__init__(instructions="private business instructions")
        self.tool_runs = 0

    async def llm_node(self, chat_ctx, tools, model_settings):
        if self.tool_runs == 0:
            yield llm.ChatChunk(
                id="chunk",
                delta=llm.ChoiceDelta(
                    role="assistant",
                    tool_calls=[llm.FunctionToolCall(call_id="c1", name="lookup", arguments="{}")],
                ),
            )
        else:
            yield "private agent response"

    async def tts_node(self, text, model_settings):
        async for _part in text:
            yield rtc.AudioFrame.create(sample_rate=24000, num_channels=1, samples_per_channel=240)

    @llm.function_tool
    async def lookup(self):
        self.tool_runs += 1
        return "private tool output"


@pytest.mark.parametrize("specific_endpoint", [False, True])
def test_sdk_call_stages_export_over_otlp_with_parentage_and_content_removed(specific_endpoint):
    requests = SimpleQueue()

    class Collector(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            if self.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            requests.put((self.path, ExportTraceServiceRequest.FromString(body)))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Collector)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    provider = None

    async def run():
        nonlocal provider
        settings = Settings(
            _env_file=None,
            otel_exporter_otlp_endpoint=f"{base_url}/base",
            otel_exporter_otlp_traces_endpoint=f"{base_url}/specific"
            if specific_endpoint
            else None,
            otel_service_name="answerline-test",
            tenant="test-tenant",
        )
        provider = configure_tracing(settings, "test-room", "test-agent")
        assert provider is not None
        recognizer = LocalSTT()
        session = AgentSession(
            llm=LocalLLM(),
            stt=recognizer,
            turn_handling=TurnHandlingOptions(interruption={"resume_false_interruption": False}),
        )
        session.input.audio = LocalInput()
        session.output.audio = LocalOutput()
        agent = LocalAgent()
        try:
            await session.start(agent=agent)
            await asyncio.wait_for(recognizer.received.wait(), timeout=2)
            await asyncio.wait_for(session.generate_reply(user_input="private caller text"), 5)
            assert agent.tool_runs == 1
            with pytest.raises(ValueError), tracer.start_as_current_span("error"):
                raise ValueError("private exception details")
        finally:
            await session.aclose()
        await flush_tracing(provider)

    try:
        asyncio.run(run())
        path, request = requests.get(timeout=2)
        assert path == ("/specific" if specific_endpoint else "/base/v1/traces")
        spans = [
            span
            for resource in request.resource_spans
            for scope in resource.scope_spans
            for span in scope.spans
        ]
        by_id = {span.span_id: span for span in spans}
        root = next(span for span in spans if span.name == "agent_session")
        for name in ("stt_node", "llm_node", "tts_node", "function_tool"):
            matching = [span for span in spans if span.name == name]
            assert matching
            for span in matching:
                assert span.end_time_unix_nano > span.start_time_unix_nano
                assert span.trace_id == root.trace_id
                attributes = {attr.key: attr.value.string_value for attr in span.attributes}
                assert attributes["answerline.room"] == "test-room"
                assert attributes["answerline.tenant"] == "test-tenant"
                assert attributes["answerline.agent"] == "test-agent"
                ancestor = span
                while ancestor.span_id != root.span_id:
                    ancestor = by_id[ancestor.parent_span_id]
        assert any(
            attribute.key == "service.name" and attribute.value.string_value == "answerline-test"
            for resource in request.resource_spans
            for attribute in resource.resource.attributes
        )
        serialized = str(request)
        for private in (
            "private business instructions",
            "private caller text",
            "private agent response",
            "private tool output",
            "private exception details",
        ):
            assert private not in serialized
    finally:
        if provider:
            provider.shutdown()
        set_tracer_provider(NoOpTracerProvider())
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_tracing_is_disabled_without_an_endpoint(monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Disabled tracing must not configure a provider or exporter")

    monkeypatch.setattr(telemetry, "OTLPSpanExporter", unexpected)
    monkeypatch.setattr(telemetry, "set_tracer_provider", unexpected)
    settings = Settings(
        _env_file=None,
        otel_exporter_otlp_endpoint=None,
        otel_exporter_otlp_traces_endpoint=None,
    )
    assert configure_tracing(settings, "room", "agent") is None


def test_flush_runs_outside_the_event_loop():
    main_thread = threading.get_ident()
    observed = []

    class Provider:
        def force_flush(self, timeout_millis):
            observed.append((threading.get_ident(), timeout_millis))

        def shutdown(self):
            observed.append((threading.get_ident(), "shutdown"))

    asyncio.run(flush_tracing(Provider()))
    assert len(observed) == 2
    assert observed[0][0] != main_thread
    assert observed[0][1] == 5000
    assert observed[1][0] != main_thread
    assert observed[1][1] == "shutdown"


@pytest.mark.parametrize(
    "fields",
    [
        {"otel_exporter_otlp_endpoint": "not-a-url"},
        {"otel_exporter_otlp_traces_endpoint": "file:///tmp/traces"},
        {"otel_exporter_otlp_timeout": 0},
        {"otel_exporter_otlp_timeout": float("inf")},
        {"otel_service_name": ""},
    ],
)
def test_invalid_tracing_settings_are_rejected(fields):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **fields)
