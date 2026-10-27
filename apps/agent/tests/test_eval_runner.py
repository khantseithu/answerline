import asyncio
import json
from typing import Any

import pytest
from answerline_agent import eval_runner
from answerline_agent.config import AgentConfig
from answerline_agent.eval_runner import (
    _evaluate_assertions,
    _judge,
    build_mock_tools,
    run_case,
    run_suite,
)
from answerline_agent.settings import Settings
from livekit import rtc
from livekit.agents import APIStatusError, llm, stt, tts
from livekit.agents.metrics import LLMMetrics, TTSMetrics
from livekit.agents.metrics.base import Metadata
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

CONFIG = {
    "name": "Test Clinic",
    "greeting": "Hello",
    "instructions": "You are a concise receptionist.",
    "models": {
        "stt": "deepgram/nova-3",
        "llm": {"primary": "openai/gpt-4.1-mini"},
        "tts": "cartesia/sonic-3",
    },
    "tools": [{"builtin": "capture_lead"}],
}


class _TextStream(llm.LLMStream):
    async def _run(self) -> None:
        self._event_ch.send_nowait(
            llm.ChatChunk(
                id="test",
                delta=llm.ChoiceDelta(role="assistant", content="Hello there."),
            )
        )


class _TextLLM(llm.LLM):
    def chat(self, *, chat_ctx, tools=None, conn_options=None, **kwargs):
        return _TextStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
        )


class _MetricsStream(_TextStream):
    async def _run(self) -> None:
        await asyncio.sleep(0.05)
        await super()._run()


class _MetricsLLM(llm.LLM):
    def chat(self, *, chat_ctx, tools=None, conn_options=None, **kwargs):
        return _MetricsStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
        )


class _ToolStream(llm.LLMStream):
    def __init__(self, *args, tool_call: bool, **kwargs):
        super().__init__(*args, **kwargs)
        self.tool_call = tool_call

    async def _run(self) -> None:
        if self.tool_call:
            delta = llm.ChoiceDelta(
                role="assistant",
                tool_calls=[
                    llm.FunctionToolCall(
                        call_id="call_1",
                        name="capture_lead",
                        arguments=(
                            '{"name":"Alex","phone":"+12025550147","reason":"Appointment question"}'
                        ),
                    )
                ],
            )
        else:
            delta = llm.ChoiceDelta(role="assistant", content="Your request was saved.")
        self._event_ch.send_nowait(llm.ChatChunk(id="test", delta=delta))


class _ToolLLM(llm.LLM):
    def __init__(self):
        super().__init__()
        self.calls = 0

    def chat(self, *, chat_ctx, tools=None, conn_options=None, **kwargs):
        self.calls += 1
        return _ToolStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
            tool_call=self.calls == 1,
        )


class _FakeSTT(stt.STT):
    def __init__(self, transcripts: list[str] | None = None):
        super().__init__(capabilities=stt.STTCapabilities(streaming=False, interim_results=False))
        self.transcripts = list(transcripts or ["Please save Alex's appointment question."])
        self.buffers: list[list[rtc.AudioFrame]] = []

    async def _recognize_impl(self, buffer, *, language, conn_options):
        assert isinstance(buffer, list)
        assert buffer
        self.buffers.append(buffer)
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[
                stt.SpeechData(
                    language="en-US",
                    text=self.transcripts.pop(0)
                    if len(self.transcripts) > 1
                    else self.transcripts[0],
                )
            ],
        )


class _FakeTTS(tts.TTS):
    def __init__(self):
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False), sample_rate=48000, num_channels=1
        )
        self.spoken: list[str] = []

    def synthesize(self, text: str, *, conn_options=None):
        self.spoken.append(text)

        class Stream(tts.ChunkedStream):
            async def _run(self, output_emitter):
                output_emitter.initialize(
                    request_id="fake",
                    sample_rate=48000,
                    num_channels=1,
                    mime_type="audio/pcm",
                    stream=False,
                )
                output_emitter.push_frame(rtc.AudioFrame.create(48000, 1, 480))
                output_emitter.flush()
                self._tts.emit(
                    "metrics_collected",
                    TTSMetrics(
                        request_id="fake",
                        timestamp=1,
                        ttfb=0.01,
                        duration=0.1,
                        characters_count=len(self._input_text),
                        audio_duration=0.01,
                        cancelled=False,
                        label="fake",
                        streamed=False,
                        metadata=Metadata(model_provider="fake", model_name="fake-tts"),
                    ),
                )

        return Stream(
            tts=self,
            input_text=text,
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
        )


class _HangingTTS(_FakeTTS):
    def synthesize(self, text: str, *, conn_options=None):
        self.spoken.append(text)

        class Stream(tts.ChunkedStream):
            async def _run(self, _output_emitter):
                await asyncio.Event().wait()

        return Stream(
            tts=self,
            input_text=text,
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
        )


class _JudgeStream(llm.LLMStream):
    def __init__(self, *args, response: str, metrics: LLMMetrics | None, **kwargs):
        super().__init__(*args, **kwargs)
        self.response = response
        self.metrics = metrics

    async def _run(self) -> None:
        self._event_ch.send_nowait(
            llm.ChatChunk(id="judge", delta=llm.ChoiceDelta(content=self.response))
        )
        if self.metrics:
            self._llm.emit("metrics_collected", self.metrics)


class _JudgeLLM(llm.LLM):
    def __init__(self, response: str, metrics: LLMMetrics | None = None):
        super().__init__()
        self.response = response
        self.metrics = metrics
        self.removed_metrics_listener = False

    def off(self, event, callback):
        super().off(event, callback)
        if event == "metrics_collected":
            self.removed_metrics_listener = True

    def chat(self, *, chat_ctx, tools=None, conn_options=None, **kwargs):
        return _JudgeStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
            response=self.response,
            metrics=self.metrics,
        )


def _config() -> AgentConfig:
    return AgentConfig.model_validate(CONFIG)


def test_run_case_reuses_session_for_multiple_caller_turns():
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "greeting", "caller": ["Hi", "Are you open?"], "expect": {}},
            llm_provider=_TextLLM(),
        )
    )
    assert result["passed"] is True
    assert result["transcript"] == [
        {"role": "agent", "text": "Hello"},
        {"role": "caller", "text": "Hi"},
        {"role": "agent", "text": "Hello there."},
        {"role": "caller", "text": "Are you open?"},
        {"role": "agent", "text": "Hello there."},
    ]
    assert result["costUsd"] is None


def test_mock_tool_records_arguments_and_returns_case_result():
    calls: list[dict[str, Any]] = []
    tool = build_mock_tools(_config(), calls=calls, mocks={"capture_lead": {"status": "accepted"}})[
        0
    ]
    result = asyncio.run(
        tool._func(
            context=object(),
            name="Alex",
            phone="+12025550147",
            reason="Appointment question",
        )
    )
    assert result == {"status": "accepted"}
    assert calls == [
        {
            "name": "capture_lead",
            "args": {
                "name": "Alex",
                "phone": "+12025550147",
                "reason": "Appointment question",
            },
        }
    ]


def test_run_case_executes_mock_tool_and_checks_its_arguments():
    result = asyncio.run(
        run_case(
            _config(),
            {
                "name": "captures lead",
                "caller": "Please call Alex back about an appointment.",
                "expect": {
                    "mentions": ["saved"],
                    "tool_called": "capture_lead",
                    "tool_args": {"capture_lead": {"name": "Alex"}},
                },
            },
            llm_provider=_ToolLLM(),
        )
    )
    assert result["passed"] is True
    assert result["transcript"][-1] == {"role": "agent", "text": "Your request was saved."}


def test_speech_failures_exclude_provider_error_body(monkeypatch):
    error = APIStatusError(
        "secret-like provider message",
        status_code=402,
        body={"user_id": "private-user", "api_key": "private-key"},
    )

    class FailedSpeech:
        async def wait_for_playout(self):
            return None

        def exception(self):
            return error

    async def failed_reply(*_args, **_kwargs):
        return FailedSpeech()

    monkeypatch.setattr(
        eval_runner.AgentSession,
        "generate_reply",
        failed_reply,
    )
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "provider failure", "caller": "Hello", "expect": {}},
            llm_provider=_TextLLM(),
        )
    )
    assert result["passed"] is False
    assert result["failures"] == ["agent response failed: APIStatusError (status 402)"]
    assert "private-user" not in json.dumps(result)
    assert "private-key" not in json.dumps(result)
    assert "secret-like provider message" not in json.dumps(result)


def test_audio_eval_runs_stt_tools_llm_and_tts_without_rtc(monkeypatch):
    providers = iter([_FakeTTS(), _FakeTTS()])
    agent_tts, caller_tts = next(providers), next(providers)
    stt_provider = _FakeSTT()
    monkeypatch.setattr(eval_runner, "build_tts", lambda _ref, **_kwargs: agent_tts)
    monkeypatch.setattr(eval_runner, "build_stt", lambda _ref, **_kwargs: stt_provider)
    monkeypatch.setattr(eval_runner, "_build_caller_tts", lambda _ref, **_kwargs: caller_tts)
    result = asyncio.run(
        run_case(
            _config(),
            {
                "name": "audio lead capture",
                "caller": "Please save Alex's appointment question.",
                "expect": {
                    "mentions": ["saved"],
                    "tool_called": "capture_lead",
                    "tool_args": {"capture_lead": {"name": "Alex"}},
                },
            },
            llm_provider=_ToolLLM(),
            mode="audio",
        )
    )
    assert result["passed"] is True
    assert result["transcript"] == [
        {"role": "agent", "text": "Hello"},
        {"role": "caller", "text": "Please save Alex's appointment question."},
        {"role": "agent", "text": "Your request was saved."},
    ]
    assert caller_tts.spoken == ["Please save Alex's appointment question."]
    caller_tts_usage = [
        line
        for line in result["modelUsage"]
        if line["stage"] == "tts" and line["model"] == "fake-tts" and line["quantity"] == 40
    ]
    assert caller_tts_usage == [
        {
            "stage": "tts",
            "provider": "fake",
            "model": "fake-tts",
            "quantity": 40,
            "unit": "characters",
        }
    ]
    stt_usage = [line for line in result["modelUsage"] if line["stage"] == "stt"]
    assert len(stt_usage) == 1
    assert stt_usage[0]["quantity"] > 0
    assert result["latencyMs"] >= 0
    assert result["wer"] == 0


def _stub_audio_providers(monkeypatch, stt_provider, built=None):
    agent_tts, caller_tts = _FakeTTS(), _FakeTTS()
    built = built if built is not None else {}

    def record(name, provider):
        def build(ref, *_args, **_kwargs):
            built[name] = ref
            return provider

        return build

    monkeypatch.setattr(eval_runner, "build_tts", record("tts", agent_tts))
    monkeypatch.setattr(eval_runner, "build_stt", record("stt", stt_provider))
    monkeypatch.setattr(eval_runner, "_build_caller_tts", record("caller_tts", caller_tts))
    return built


def test_audio_eval_scores_wer_per_turn_and_averages_the_case(monkeypatch):
    _stub_audio_providers(monkeypatch, _FakeSTT(["my number is 202 555 0147", "book a tuesday"]))
    result = asyncio.run(
        run_case(
            _config(),
            {
                "name": "wer",
                "caller": ["My number is 202-555-0147.", "Book me on Tuesday"],
                "expect": {},
            },
            llm_provider=_TextLLM(),
            mode="audio",
        )
    )
    assert result["wer"] == 0.25
    assert result["passed"] is True


def test_audio_eval_fails_when_wer_is_over_max_wer(monkeypatch):
    _stub_audio_providers(monkeypatch, _FakeSTT(["book a tuesday"]))
    case = {"name": "wer", "caller": "Book me on Tuesday", "expect": {"max_wer": 0.25}}
    result = asyncio.run(run_case(_config(), case, llm_provider=_TextLLM(), mode="audio"))
    assert result["wer"] == pytest.approx(0.5)
    assert result["passed"] is False
    assert result["failures"] == ["word error rate 0.5000 is over max_wer 0.25"]


def test_audio_eval_passes_when_wer_is_within_max_wer(monkeypatch):
    _stub_audio_providers(monkeypatch, _FakeSTT(["book me on tuesday"]))
    case = {"name": "wer", "caller": "Book me on Tuesday", "expect": {"max_wer": 0}}
    result = asyncio.run(run_case(_config(), case, llm_provider=_TextLLM(), mode="audio"))
    assert result["wer"] == 0
    assert result["passed"] is True


def test_text_mode_has_no_wer_and_ignores_max_wer():
    case = {"name": "text", "caller": "Hi", "expect": {"max_wer": 0}}
    result = asyncio.run(run_case(_config(), case, llm_provider=_TextLLM()))
    assert result["wer"] is None
    assert result["passed"] is True


def test_assertions_ignore_max_wer_without_a_wer():
    case = {"expect": {"max_wer": 0.1}}
    assert _evaluate_assertions(case, [], [], None) == []
    assert _evaluate_assertions(case, [], [], 0.1) == []
    assert _evaluate_assertions(case, [], [], 0.2) == ["word error rate 0.2000 is over max_wer 0.1"]


def test_stt_and_tts_overrides_replace_models_for_pipeline_and_caller(monkeypatch):
    built = _stub_audio_providers(monkeypatch, _FakeSTT())
    asyncio.run(
        run_case(
            _config(),
            {"name": "override", "caller": "Hello", "expect": {}},
            llm_provider=_TextLLM(),
            mode="audio",
            stt_override="deepgram/nova-2",
            tts_override="cartesia/sonic-2",
        )
    )
    assert built == {
        "stt": "deepgram/nova-2",
        "tts": "cartesia/sonic-2",
        "caller_tts": "cartesia/sonic-2",
    }


def _stub_caller_audio_providers(monkeypatch, stt_provider):
    built: dict[str, tuple] = {}
    agent_tts, caller_tts = _FakeTTS(), _FakeTTS()

    def build_agent_tts(ref, *_args, **kwargs):
        built["tts"] = (ref, kwargs)
        return agent_tts

    def build_caller_tts(ref, *_args, **kwargs):
        built["caller_tts"] = (ref, kwargs)
        return caller_tts

    monkeypatch.setattr(eval_runner, "build_tts", build_agent_tts)
    monkeypatch.setattr(eval_runner, "build_stt", lambda *_args, **_kwargs: stt_provider)
    monkeypatch.setattr(eval_runner, "_build_caller_tts", build_caller_tts)
    return built


def test_caller_audio_tts_and_voice_apply_to_the_caller_only(monkeypatch):
    built = _stub_caller_audio_providers(monkeypatch, _FakeSTT())
    asyncio.run(
        run_case(
            _config(),
            {"name": "caller voice", "caller": "Hello", "expect": {}},
            llm_provider=_TextLLM(),
            mode="audio",
            tts_override="cartesia/sonic-2",
            caller_audio={"tts": "cartesia/sonic-turbo", "voice": "voice-123"},
        )
    )
    assert built["tts"] == ("cartesia/sonic-2", {"language": "en"})
    assert built["caller_tts"] == (
        "cartesia/sonic-turbo",
        {"language": "en", "voice": "voice-123"},
    )


def test_caller_audio_without_tts_falls_back_to_the_agent_tts_with_the_voice(monkeypatch):
    built = _stub_caller_audio_providers(monkeypatch, _FakeSTT())
    asyncio.run(
        run_case(
            _config(),
            {"name": "caller voice", "caller": "Hello", "expect": {}},
            llm_provider=_TextLLM(),
            mode="audio",
            tts_override="cartesia/sonic-2",
            caller_audio={"voice": "voice-123"},
        )
    )
    assert built["caller_tts"][0] == "cartesia/sonic-2"
    assert built["caller_tts"][1]["voice"] == "voice-123"


def test_phone_profile_feeds_narrowband_frames_to_stt(monkeypatch):
    stt_provider = _FakeSTT()
    _stub_caller_audio_providers(monkeypatch, stt_provider)
    asyncio.run(
        run_case(
            _config(),
            {"name": "phone", "caller": "Hello", "expect": {}},
            llm_provider=_TextLLM(),
            mode="audio",
            caller_audio={"profile": "phone", "noiseSnrDb": 20, "seed": 4},
        )
    )
    (buffer,) = stt_provider.buffers
    assert {frame.sample_rate for frame in buffer} == {8000}
    assert {frame.num_channels for frame in buffer} == {1}


def test_clean_caller_audio_reaches_stt_at_the_synthesized_rate(monkeypatch):
    stt_provider = _FakeSTT()
    _stub_caller_audio_providers(monkeypatch, stt_provider)
    asyncio.run(
        run_case(
            _config(),
            {"name": "clean", "caller": "Hello", "expect": {}},
            llm_provider=_TextLLM(),
            mode="audio",
            caller_audio={"profile": "clean"},
        )
    )
    (buffer,) = stt_provider.buffers
    assert {frame.sample_rate for frame in buffer} == {48000}


def test_caller_audio_settings_reach_the_degrader(monkeypatch):
    _stub_caller_audio_providers(monkeypatch, _FakeSTT())
    seen = {}

    def record(frames, **kwargs):
        seen.update(kwargs)
        return frames

    monkeypatch.setattr(eval_runner, "degrade_caller_audio", record)
    asyncio.run(
        run_case(
            _config(),
            {"name": "wiring", "caller": "Hello", "expect": {}},
            llm_provider=_TextLLM(),
            mode="audio",
            caller_audio={"profile": "phone", "noiseSnrDb": 12.5, "seed": 9},
        )
    )
    assert seen == {"profile": "phone", "noise_snr_db": 12.5, "seed": 9, "padding_frames": 1}


def test_caller_audio_is_ignored_in_text_mode(monkeypatch):
    def fail(*_args, **_kwargs):
        raise AssertionError("caller audio must not run in text mode")

    monkeypatch.setattr(eval_runner, "degrade_caller_audio", fail)
    monkeypatch.setattr(eval_runner, "_build_caller_tts", fail)
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "text", "caller": "Hi", "expect": {}},
            llm_provider=_TextLLM(),
            caller_audio={"profile": "phone", "noiseSnrDb": 10, "tts": "cartesia/x", "voice": "v"},
        )
    )
    assert result["passed"] is True
    assert result["wer"] is None


def test_run_suite_passes_caller_audio_to_the_runner(monkeypatch):
    stt_provider = _FakeSTT()
    built = _stub_caller_audio_providers(monkeypatch, stt_provider)
    monkeypatch.setattr(eval_runner, "build_llm_chain", lambda _models: _TextLLM())
    payload = {
        "agent": CONFIG,
        "callerAudio": {
            "noiseSnrDb": 25,
            "profile": "phone",
            "seed": 3,
            "tts": "cartesia/sonic-2",
            "voice": "voice-9",
        },
        "mode": "audio",
        "suite": [{"name": "phone", "caller": "Hello", "expect": {}}],
    }
    asyncio.run(run_suite(payload))
    assert built["caller_tts"] == ("cartesia/sonic-2", {"language": "en", "voice": "voice-9"})
    assert {frame.sample_rate for frame in stt_provider.buffers[0]} == {8000}


def test_audio_models_default_to_the_agent_config_without_overrides(monkeypatch):
    built = _stub_audio_providers(monkeypatch, _FakeSTT())
    asyncio.run(
        run_case(
            _config(),
            {"name": "defaults", "caller": "Hello", "expect": {}},
            llm_provider=_TextLLM(),
            mode="audio",
        )
    )
    assert built == {
        "stt": "deepgram/nova-3",
        "tts": "cartesia/sonic-3",
        "caller_tts": "cartesia/sonic-3",
    }


def test_run_suite_passes_overrides_and_aggregates_wer(monkeypatch):
    built = _stub_audio_providers(monkeypatch, _FakeSTT(["book a tuesday", "hello"]))
    monkeypatch.setattr(eval_runner, "build_llm_chain", lambda _models: _TextLLM())
    payload = {
        "agent": CONFIG,
        "mode": "audio",
        "sttOverride": "deepgram/nova-2",
        "suite": [
            {"name": "wrong", "caller": "Book me on Tuesday", "expect": {}},
            {"name": "right", "caller": "Hello", "expect": {}},
        ],
        "ttsOverride": "cartesia/sonic-2",
    }
    output = asyncio.run(run_suite(payload))
    assert built["stt"] == "deepgram/nova-2"
    assert built["tts"] == built["caller_tts"] == "cartesia/sonic-2"
    assert [result["wer"] for result in output["results"]] == [0.5, 0]
    assert output["aggregate"]["avgWer"] == 0.25


def test_run_suite_reports_null_wer_in_text_mode(monkeypatch):
    monkeypatch.setattr(eval_runner, "build_llm_chain", lambda _models: _TextLLM())
    payload = {"agent": CONFIG, "suite": [{"name": "text", "caller": "Hi", "expect": {}}]}
    output = asyncio.run(run_suite(payload))
    assert output["results"][0]["wer"] is None
    assert output["aggregate"]["avgWer"] is None


def test_text_eval_records_llm_stage_latency_per_turn():
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "two turns", "caller": ["Hi", "Hours?"], "expect": {}},
            llm_provider=_MetricsLLM(),
        )
    )
    stages = result["stageLatency"]
    assert set(stages) == {"llmTtftMs", "llmTotalMs"}
    for samples in stages.values():
        assert len(samples) == 2
        assert all(isinstance(value, int) and value >= 40 for value in samples)


def test_audio_eval_records_stt_llm_and_tts_stage_latency(monkeypatch):
    agent_tts, caller_tts = _FakeTTS(), _FakeTTS()
    monkeypatch.setattr(eval_runner, "build_tts", lambda _ref, **_kwargs: agent_tts)
    monkeypatch.setattr(eval_runner, "build_stt", lambda _ref, **_kwargs: _FakeSTT())
    monkeypatch.setattr(eval_runner, "_build_caller_tts", lambda _ref, **_kwargs: caller_tts)
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "audio stages", "caller": "Please save it.", "expect": {}},
            llm_provider=_MetricsLLM(),
            mode="audio",
        )
    )
    stages = result["stageLatency"]
    assert set(stages) == {"sttMs", "llmTtftMs", "llmTotalMs", "ttsTtfbMs"}
    assert all(len(samples) == 1 for samples in stages.values())
    assert all(isinstance(samples[0], int) and samples[0] >= 0 for samples in stages.values())
    assert stages["llmTotalMs"][0] >= 40


def test_run_suite_output_with_stage_latency_matches_wire_schema(monkeypatch):
    monkeypatch.setattr(eval_runner, "build_llm_chain", lambda _models: _MetricsLLM())
    output = asyncio.run(
        run_suite(
            {
                "agent": CONFIG,
                "suite": [{"name": "stages", "caller": "Hi", "expect": {}}],
            }
        )
    )
    stages = output["results"][0]["stageLatency"]
    assert len(stages["llmTotalMs"]) == 1


def test_audio_eval_timeout_closes_session_and_providers(monkeypatch):
    caller_tts = _HangingTTS()
    agent_tts = _FakeTTS()
    stt_provider = _FakeSTT()
    closed = []

    async def close(provider):
        closed.append(provider)

    monkeypatch.setattr(eval_runner, "EVAL_PHASE_TIMEOUT", 0.01)
    monkeypatch.setattr(eval_runner, "build_stt", lambda _ref, **_kwargs: stt_provider)
    monkeypatch.setattr(eval_runner, "build_tts", lambda _ref, **_kwargs: agent_tts)
    monkeypatch.setattr(eval_runner, "_build_caller_tts", lambda _ref, **_kwargs: caller_tts)
    monkeypatch.setattr(caller_tts, "aclose", lambda: close(caller_tts))
    monkeypatch.setattr(agent_tts, "aclose", lambda: close(agent_tts))
    monkeypatch.setattr(stt_provider, "aclose", lambda: close(stt_provider))
    closed_sessions = []
    original_session = eval_runner.AgentSession

    class TrackingSession(original_session):
        async def aclose(self):
            closed_sessions.append(self)
            await super().aclose()

    monkeypatch.setattr(eval_runner, "AgentSession", TrackingSession)
    with pytest.raises(TimeoutError):
        asyncio.run(
            run_case(
                _config(),
                {"name": "audio timeout", "caller": "Hello", "expect": {}},
                llm_provider=_TextLLM(),
                mode="audio",
            )
        )
    assert len(closed_sessions) == 1
    assert closed == [caller_tts, agent_tts, stt_provider]


def test_assertions_check_mentions_tools_and_arguments():
    case = {
        "expect": {
            "mentions": ["saved"],
            "not_mentions": ["guaranteed"],
            "tool_called": "capture_lead",
            "tool_args": {"capture_lead": {"name": "Alex"}},
        }
    }
    transcript = [{"role": "agent", "text": "Your request was saved."}]
    calls = [{"name": "capture_lead", "args": {"name": "Alex", "phone": "+12025550147"}}]
    assert _evaluate_assertions(case, transcript, calls) == []


def test_assertions_report_all_failures():
    case = {
        "expect": {
            "mentions": ["appointment"],
            "not_mentions": ["saved"],
            "tool_called": "capture_lead",
            "tool_args": {"capture_lead": {"name": "Alex"}},
        }
    }
    failures = _evaluate_assertions(case, [{"role": "agent", "text": "The request was saved."}], [])
    assert len(failures) == 4


def test_judge_rejects_invalid_json():
    provider = _JudgeLLM("yes")
    passed, reason, usage = asyncio.run(_judge(provider, "Meets the rubric", [], []))
    assert passed is False
    assert reason == "judge returned invalid JSON"
    assert usage == []
    assert provider.removed_metrics_listener is True


def test_judge_accepts_only_valid_structured_result():
    passed, reason, _usage = asyncio.run(
        _judge(
            _JudgeLLM('{"passed": true, "reason": "Evidence meets rubric"}'),
            "Meets the rubric",
            [],
            [],
        )
    )
    assert passed is True
    assert reason == "Evidence meets rubric"


def test_judge_usage_uses_metrics_model_and_splits_cached_tokens():
    metrics = LLMMetrics(
        label="judge",
        request_id="judge-request",
        timestamp=1,
        duration=0.5,
        ttft=0.1,
        cancelled=False,
        completion_tokens=4,
        prompt_tokens=30,
        prompt_cached_tokens=6,
        cache_creation_tokens=2,
        total_tokens=34,
        tokens_per_second=8,
        metadata=Metadata(model_provider="anthropic", model_name="claude-fallback"),
    )
    provider = _JudgeLLM('{"passed": true, "reason": "Evidence meets rubric"}', metrics=metrics)
    passed, _reason, usage = asyncio.run(_judge(provider, "Meets the rubric", [], []))
    assert passed is True
    assert usage == [
        {
            "stage": "llm",
            "provider": "anthropic",
            "model": "claude-fallback",
            "quantity": 22,
            "unit": "input_tokens",
        },
        {
            "stage": "llm",
            "provider": "anthropic",
            "model": "claude-fallback",
            "quantity": 6,
            "unit": "cached_input_tokens",
        },
        {
            "stage": "llm",
            "provider": "anthropic",
            "model": "claude-fallback",
            "quantity": 2,
            "unit": "cache_creation_tokens",
        },
        {
            "stage": "llm",
            "provider": "anthropic",
            "model": "claude-fallback",
            "quantity": 4,
            "unit": "output_tokens",
        },
    ]
    assert provider.removed_metrics_listener is True


def test_shared_execution_fixtures_match_wire_schemas():
    fixtures = (
        ("execution-input.json", "eval-execution-input.schema.json"),
        ("execution-output.json", "eval-execution-output.schema.json"),
    )
    for fixture_name, schema_name in fixtures:
        fixture = eval_runner.REPO_ROOT / "packages/shared/fixtures/eval/valid" / fixture_name
        payload = json.loads(fixture.read_text())
        eval_runner._validate_wire_payload(payload, schema_name)


def test_run_suite_validates_output_and_keeps_mock_tools_off_database(monkeypatch):
    async def forbidden(*_args, **_kwargs):
        raise AssertionError("mock eval touched a live tool provider")

    monkeypatch.setattr(eval_runner, "open_booking_provider", forbidden)
    monkeypatch.setattr(eval_runner, "open_knowledge_tools", forbidden)
    monkeypatch.setattr(eval_runner, "build_llm_chain", lambda _models: _TextLLM())
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    agent = {
        **CONFIG,
        "hours": {"timezone": "UTC", "weekdays": "09:00-18:00"},
        "tools": [{"builtin": "book_appointment"}],
    }
    payload = {
        "agent": agent,
        "suite": [{"name": "greeting", "caller": "Hi", "expect": {}}],
    }
    output = asyncio.run(run_suite(payload))
    assert output["aggregate"]["total"] == 1
    greeting = output["results"][0]["transcript"][0]
    assert greeting["role"] == "agent"
    assert greeting["text"]


def test_run_suite_opens_http_context_for_provider_execution(monkeypatch):
    payload = {
        "agent": CONFIG,
        "suite": [{"name": "http context", "caller": "Hi", "expect": {}}],
    }
    sessions = []

    async def run_case_with_http_context(*_args, **_kwargs):
        session = eval_runner.http_context.http_session()
        assert not session.closed
        sessions.append(session)
        return {
            "caseName": "http context",
            "passed": True,
            "failures": [],
            "transcript": [],
            "latencyMs": 1,
            "costUsd": None,
            "modelUsage": [],
            "wer": None,
        }

    monkeypatch.setattr(eval_runner, "run_case", run_case_with_http_context)
    output = asyncio.run(run_suite(payload))
    assert output["aggregate"]["passed"] == 1
    assert sessions[0].closed
    with pytest.raises(RuntimeError, match="outside of a job context"):
        eval_runner.http_context.http_session()


def test_live_tools_use_the_supplied_tenant_and_agent_slugs(monkeypatch):
    received = {}

    async def live_tools(_config, settings, *, agent_slug, tenant_slug):
        received.update(
            agent_slug=agent_slug,
            tenant_slug=tenant_slug,
            settings_tenant=settings.tenant,
        )
        return [], []

    monkeypatch.setattr(eval_runner, "_build_live_tools", live_tools)
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "greeting", "caller": "Hi", "expect": {}},
            llm_provider=_TextLLM(),
            live_tools=True,
            context={"agentSlug": "configured-slug", "tenantSlug": "configured-tenant"},
        )
    )
    assert result["passed"] is True
    assert received == {
        "agent_slug": "configured-slug",
        "tenant_slug": "configured-tenant",
        "settings_tenant": "configured-tenant",
    }


def test_live_tools_require_context():
    with pytest.raises(ValueError, match="requires agentSlug and tenantSlug context"):
        asyncio.run(
            run_case(
                _config(),
                {"name": "greeting", "caller": "Hi", "expect": {}},
                llm_provider=_TextLLM(),
                live_tools=True,
            )
        )


JUDGE_CASE = {"name": "judged", "caller": "Hi", "expect": {"judge": "Greets the caller"}}
JUDGE_PASS = '{"passed": true, "reason": "Greets the caller"}'


def _record_judge_builds(monkeypatch) -> list[str]:
    refs: list[str] = []

    def build(ref, _provider_keys=None):
        refs.append(ref)
        return _JudgeLLM(JUDGE_PASS)

    monkeypatch.setattr(eval_runner, "build_llm", build)
    return refs


def test_judge_model_grades_instead_of_the_model_under_test(monkeypatch):
    refs = _record_judge_builds(monkeypatch)
    result = asyncio.run(
        run_case(
            _config(),
            JUDGE_CASE,
            model_override="openai/gpt-4.1",
            judge_model="anthropic/claude-sonnet-4-5",
            llm_provider=_TextLLM(),
        )
    )
    assert refs == ["anthropic/claude-sonnet-4-5"]
    assert result["passed"] is True


def test_judge_model_falls_back_to_eval_judge_model_setting(monkeypatch):
    refs = _record_judge_builds(monkeypatch)
    settings = Settings(eval_judge_model="google/gemini-2.5-flash")
    asyncio.run(run_case(_config(), JUDGE_CASE, settings=settings, llm_provider=_TextLLM()))
    asyncio.run(
        run_case(
            _config(),
            JUDGE_CASE,
            judge_model="anthropic/claude-sonnet-4-5",
            settings=settings,
            llm_provider=_TextLLM(),
        )
    )
    assert refs == ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4-5"]


def test_agent_llm_still_judges_when_no_judge_model_is_set(monkeypatch):
    refs = _record_judge_builds(monkeypatch)
    result = asyncio.run(
        run_case(_config(), JUDGE_CASE, settings=Settings(), llm_provider=_TextLLM())
    )
    assert refs == []
    assert result["failures"] == ["judge failed: judge returned invalid JSON"]


def test_run_suite_passes_the_payload_judge_model(monkeypatch):
    refs = _record_judge_builds(monkeypatch)
    monkeypatch.setattr(eval_runner, "build_llm_chain", lambda _models: _TextLLM())
    payload = {"agent": CONFIG, "judgeModel": "anthropic/claude-sonnet-4-5", "suite": [JUDGE_CASE]}
    output = asyncio.run(run_suite(payload))
    assert refs == ["anthropic/claude-sonnet-4-5"]
    assert output["aggregate"]["passed"] == 1


def test_judge_model_is_not_built_for_cases_without_a_judge(monkeypatch):
    refs = _record_judge_builds(monkeypatch)
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "greeting", "caller": "Hi", "expect": {}},
            judge_model="anthropic/claude-sonnet-4-5",
            llm_provider=_TextLLM(),
        )
    )
    assert refs == []
    assert result["passed"] is True
