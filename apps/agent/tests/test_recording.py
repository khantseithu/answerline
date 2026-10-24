import asyncio
from types import SimpleNamespace

from answerline_agent import recording
from answerline_agent.config import AgentConfig
from answerline_agent.recording import (
    CallRecording,
    RecordingSettings,
    build_call_recording,
    recording_key,
    start_with_notice,
)
from livekit import api


class FakeEgress:
    def __init__(self, error: Exception | None = None, started_at_ns: int = 0):
        self.error = error
        self.started_at_ns = started_at_ns
        self.started = []
        self.stopped = []

    async def start_room_composite_egress(self, request):
        if self.error:
            raise self.error
        self.started.append(request)
        return SimpleNamespace(egress_id="EG_1", started_at=self.started_at_ns)

    async def stop_egress(self, request):
        if self.error:
            raise self.error
        self.stopped.append(request)


class FakeSession:
    def __init__(self):
        self.said = []

    async def say(self, text):
        self.said.append(text)


def _recording(egress):
    return CallRecording(egress, room_name="call-1", tenant="acme", bucket="recordings")


def _config(**recording_config):
    return AgentConfig.model_validate(
        {
            "name": "A",
            "greeting": "Hi",
            "instructions": "Be brief.",
            "models": {
                "stt": "deepgram/nova-3",
                "llm": {"primary": "anthropic/claude-sonnet-4-6"},
                "tts": "cartesia/sonic-3",
            },
            "recording": recording_config,
        }
    )


def test_key_is_tenant_then_room():
    assert recording_key("acme", "call-1") == "acme/call-1.ogg"


def test_start_requests_audio_only_room_composite_ogg():
    egress = FakeEgress()
    call_recording = _recording(egress)
    assert call_recording.url is None
    assert asyncio.run(call_recording.start()) is True
    request = egress.started[0]
    assert request.room_name == "call-1"
    assert request.audio_only is True
    assert request.layout == ""
    assert request.file_outputs[0].file_type == api.EncodedFileType.OGG
    assert request.file_outputs[0].filepath == "acme/call-1.ogg"
    assert call_recording.url == "s3://recordings/acme/call-1.ogg"


def test_start_records_egress_start_time_from_nanoseconds():
    call_recording = _recording(FakeEgress(started_at_ns=1_782_000_000_500_000_000))
    assert call_recording.started_at is None
    asyncio.run(call_recording.start())
    assert call_recording.started_at == 1_782_000_000.5


def test_start_without_egress_start_time_uses_current_time(monkeypatch):
    monkeypatch.setattr(recording.time, "time", lambda: 1_782_000_123.0)
    call_recording = _recording(FakeEgress())
    asyncio.run(call_recording.start())
    assert call_recording.started_at == 1_782_000_123.0


def test_start_failure_is_swallowed_and_leaves_no_url():
    call_recording = _recording(FakeEgress(error=RuntimeError("no egress")))
    assert asyncio.run(call_recording.start()) is False
    assert call_recording.url is None
    assert call_recording.started_at is None


def test_start_timeout_is_swallowed(monkeypatch):
    class Slow(FakeEgress):
        async def start_room_composite_egress(self, request):
            await asyncio.sleep(1)

    monkeypatch.setattr(recording, "START_TIMEOUT", 0.01)
    call_recording = _recording(Slow())
    assert asyncio.run(call_recording.start()) is False
    assert call_recording.url is None


def test_stop_ends_the_egress_and_swallows_errors():
    egress = FakeEgress()
    call_recording = _recording(egress)
    asyncio.run(call_recording.stop())
    assert egress.stopped == []
    asyncio.run(call_recording.start())
    asyncio.run(call_recording.stop())
    assert egress.stopped[0].egress_id == "EG_1"
    egress.error = RuntimeError("already ended")
    asyncio.run(call_recording.stop())


def test_notice_is_spoken_only_when_recording_started():
    session = FakeSession()
    asyncio.run(start_with_notice(_recording(FakeEgress()), session, "Recorded."))
    assert session.said == ["Recorded."]
    session = FakeSession()
    asyncio.run(start_with_notice(_recording(FakeEgress(error=RuntimeError())), session, "x"))
    assert session.said == []


def test_disabled_agent_never_builds_a_recording():
    ctx = SimpleNamespace(api=SimpleNamespace(egress=FakeEgress()), room=SimpleNamespace(name="r"))
    assert build_call_recording(ctx, _config(), "default") is None
    assert build_call_recording(ctx, _config(enabled=False), "default") is None


def test_enabled_agent_builds_a_recording_for_the_room():
    ctx = SimpleNamespace(api=SimpleNamespace(egress=FakeEgress()), room=SimpleNamespace(name="r1"))
    built = build_call_recording(
        ctx, _config(enabled=True), "acme", RecordingSettings(s3_bucket="calls")
    )
    assert built is not None
    asyncio.run(built.start())
    assert built.url == "s3://calls/acme/r1.ogg"
