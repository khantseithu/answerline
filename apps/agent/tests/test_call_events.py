from answerline_agent.call_events import CallRecorder, call_event_payload, summarize_usage
from livekit.agents.metrics import LLMModelUsage, STTModelUsage, TTSModelUsage

START = 1_792_677_600.0


def _recorder() -> CallRecorder:
    return CallRecorder(room_name="call-1", tenant="default", agent="bright-smile-dental")


def test_web_call_started_has_no_numbers():
    event = _recorder().start(
        is_sip=False, started_at=START, attributes={"sip.phoneNumber": "+15555550123"}
    )
    assert event.channel == "web"
    assert event.direction == "inbound"
    assert event.from_number is None
    assert event.to_number is None
    assert event.started_at == "2026-10-22T14:00:00.000+00:00"


def test_sip_call_started_reads_numbers_from_attributes():
    event = _recorder().start(
        is_sip=True,
        started_at=START,
        attributes={"sip.phoneNumber": "+15555550123", "sip.trunkPhoneNumber": "+15555550100"},
    )
    assert event.channel == "sip"
    assert event.from_number == "+15555550123"
    assert event.to_number == "+15555550100"


def test_sip_call_started_without_attributes():
    payload = call_event_payload(_recorder().start(is_sip=True, started_at=START))
    assert payload["channel"] == "sip"
    assert "from_number" not in payload
    assert "to_number" not in payload


def test_turns_increment_seq_and_map_roles():
    recorder = _recorder()
    first = recorder.turn(role="assistant", text="Hello", created_at=START)
    second = recorder.turn(role="user", text="Hi", created_at=START + 1)
    third = recorder.turn(role="assistant", text="How can I help?", created_at=START + 2)
    assert [t.seq for t in (first, second, third)] == [0, 1, 2]
    assert [t.role for t in (first, second, third)] == ["agent", "caller", "agent"]


def test_unmapped_roles_and_empty_text_do_not_consume_seq():
    recorder = _recorder()
    assert recorder.turn(role="system", text="x", created_at=START) is None
    assert recorder.turn(role="developer", text="x", created_at=START) is None
    assert recorder.turn(role="user", text=None, created_at=START) is None
    assert recorder.turn(role="user", text="", created_at=START) is None
    turn = recorder.turn(role="user", text="hi", created_at=START)
    assert turn is not None
    assert turn.seq == 0


def test_turn_uses_metrics_for_timing_and_latency():
    turn = _recorder().turn(
        role="assistant",
        text="Sure",
        created_at=START + 10,
        interrupted=True,
        metrics={
            "started_speaking_at": START + 5,
            "stopped_speaking_at": START + 7.5,
            "llm_node_ttft": 0.42,
            "tts_node_ttfb": 0.15,
        },
    )
    assert turn is not None
    assert turn.interrupted is True
    assert turn.started_at == "2026-10-22T14:00:05.000+00:00"
    assert turn.ended_at == "2026-10-22T14:00:07.500+00:00"
    assert turn.latency is not None
    assert turn.latency.llm_ttft_ms == 420
    assert turn.latency.tts_ttfb_ms == 150
    assert turn.latency.stt_ms is None


def test_turn_without_metrics_falls_back_to_created_at():
    turn = _recorder().turn(role="user", text="hi", created_at=START)
    assert turn is not None
    assert turn.started_at == "2026-10-22T14:00:00.000+00:00"
    payload = call_event_payload(turn)
    assert "ended_at" not in payload
    assert "latency" not in payload
    assert payload["interrupted"] is False


def test_ended_completed_and_failed():
    recorder = _recorder()
    recorder.start(is_sip=False, started_at=START)
    completed = recorder.end(ended_at=START + 180.25, failed=False)
    failed = recorder.end(ended_at=START + 5, failed=True)
    assert completed.status == "completed"
    assert completed.duration_ms == 180250
    assert completed.ended_at == "2026-10-22T14:03:00.250+00:00"
    assert failed.status == "failed"
    assert failed.duration_ms == 5000


def test_ended_without_start_has_zero_duration():
    event = _recorder().end(ended_at=START, failed=False)
    assert event.duration_ms == 0


def test_ended_carries_recording_url_only_when_set():
    recorder = _recorder()
    recorder.start(is_sip=False, started_at=START)
    plain = call_event_payload(recorder.end(ended_at=START + 1, failed=False))
    recorded = call_event_payload(
        recorder.end(ended_at=START + 1, failed=False, recording_url="s3://recordings/d/call-1.ogg")
    )
    assert "recording_url" not in plain
    assert recorded["recording_url"] == "s3://recordings/d/call-1.ogg"


def test_summarize_usage_sums_models():
    usage = [
        STTModelUsage(provider="deepgram", model="nova", audio_duration=10.5),
        STTModelUsage(provider="deepgram", model="nova-2", audio_duration=2.0),
        LLMModelUsage(provider="anthropic", model="haiku", input_tokens=100, output_tokens=20),
        TTSModelUsage(provider="cartesia", model="sonic", characters_count=50, audio_duration=3.0),
    ]
    assert summarize_usage(usage) == {
        "stt_seconds": 12.5,
        "llm_input_tokens": 100,
        "llm_output_tokens": 20,
        "tts_characters": 50,
        "tts_audio_seconds": 3.0,
    }


def test_summarize_usage_empty_is_none():
    assert summarize_usage([]) is None
