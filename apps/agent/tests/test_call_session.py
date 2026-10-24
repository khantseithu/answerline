import asyncio
from types import SimpleNamespace

from answerline_agent import call_session
from answerline_agent.call_session import CallSessionEvents
from answerline_agent.tool_log import ToolLog
from livekit import rtc
from livekit.agents.llm import AgentHandoff, ChatMessage, FunctionCall, FunctionCallOutput
from livekit.agents.metrics import LLMModelUsage, STTModelUsage
from livekit.agents.voice.events import (
    CloseEvent,
    CloseReason,
    ConversationItemAddedEvent,
    FunctionToolsExecutedEvent,
)


class FakeSession:
    def __init__(self, usage=()):
        self.handlers = {}
        self.usage = SimpleNamespace(model_usage=list(usage))

    def on(self, name, handler):
        self.handlers[name] = handler


class FakePublisher:
    def __init__(self):
        self.events = []
        self.flushed = False
        self.closed = False

    def publish(self, event):
        self.events.append(event)

    async def flush(self):
        self.flushed = True

    async def close(self):
        self.closed = True


def _events(session=None, publisher=None, recording_url=None, tool_log=None):
    session = session or FakeSession()
    publisher = publisher or FakePublisher()
    events = CallSessionEvents(
        session=session,
        publisher=publisher,
        room_name="call-1",
        tenant="default",
        agent="bright-smile-dental",
        recording_url=recording_url,
        tool_log=tool_log,
    )
    return events, session, publisher


def _item(role, text, **kwargs):
    message = ChatMessage(role=role, content=[text], **kwargs)
    return ConversationItemAddedEvent(item=message)


def _participant(kind, attributes):
    return SimpleNamespace(kind=kind, attributes=attributes)


def test_started_for_sip_participant_reads_attributes():
    events, _, publisher = _events()
    events.started(
        _participant(
            rtc.ParticipantKind.PARTICIPANT_KIND_SIP,
            {"sip.phoneNumber": "+15555550123", "sip.trunkPhoneNumber": "+15555550100"},
        )
    )
    started = publisher.events[0]
    assert started.channel == "sip"
    assert started.from_number == "+15555550123"
    assert started.to_number == "+15555550100"


def test_started_for_standard_or_missing_participant_is_web():
    for participant in (_participant(rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD, {}), None):
        events, _, publisher = _events()
        events.started(participant)
        assert publisher.events[0].channel == "web"


def test_committed_messages_become_ordered_turns():
    _, session, publisher = _events()
    on_item = session.handlers["conversation_item_added"]
    on_item(_item("assistant", "Hello!"))
    on_item(_item("user", "Hi", interrupted=True, metrics={"transcription_delay": 0.2}))
    on_item(_item("system", "ignored"))
    on_item(ConversationItemAddedEvent(item=AgentHandoff(new_agent_id="b")))
    turns = publisher.events
    assert [(t.seq, t.role, t.text) for t in turns] == [(0, "agent", "Hello!"), (1, "caller", "Hi")]
    assert turns[1].interrupted is True
    assert turns[1].latency.stt_ms == 200


def _tools_executed(*pairs):
    calls, outputs = [], []
    for index, (name, arguments, output, is_error, started, finished) in enumerate(pairs):
        call_id = f"call_{index}"
        calls.append(
            FunctionCall(call_id=call_id, name=name, arguments=arguments, created_at=started)
        )
        outputs.append(
            FunctionCallOutput(
                call_id=call_id,
                name=name,
                output=output,
                is_error=is_error,
                created_at=finished,
            )
        )
    return FunctionToolsExecutedEvent(function_calls=calls, function_call_outputs=outputs)


def test_executed_tools_become_ordered_tool_events():
    _, session, publisher = _events()
    session.handlers["function_tools_executed"](
        _tools_executed(
            ("search_knowledge", '{"query": "hours"}', "Open 9 to 5", False, 100.0, 100.25),
            ("book_appointment", "{}", "slot taken", True, 100.0, 100.5),
        )
    )
    session.handlers["function_tools_executed"](
        _tools_executed(("search_knowledge", '{"query": "price"}', "$50", False, 110.0, 110.1))
    )
    first, second, third = publisher.events
    assert [e.type for e in publisher.events] == ["call.tool"] * 3
    assert [e.seq for e in publisher.events] == [0, 1, 2]
    assert (first.name, first.args, first.result, first.status) == (
        "search_knowledge",
        {"query": "hours"},
        "Open 9 to 5",
        "ok",
    )
    assert first.latency_ms == 250
    assert (second.status, second.error, second.result, second.latency_ms) == (
        "error",
        "slot taken",
        None,
        500,
    )
    assert third.args == {"query": "price"}


def test_attached_tool_log_data_becomes_the_logged_result():
    tool_log = ToolLog()
    _, session, publisher = _events(tool_log=tool_log)
    logged = {"text": "Open 9 to 5", "outcome": "ok", "citations": [{"source_id": "s1"}]}
    tool_log.attach("call_0", logged)
    session.handlers["function_tools_executed"](
        _tools_executed(
            ("search_knowledge", '{"query": "hours"}', "Open 9 to 5", False, 100.0, 100.2),
            ("lookup", "{}", "plain", False, 100.0, 100.2),
        )
    )
    first, second = publisher.events
    assert first.result == logged
    assert second.result == "plain"
    assert tool_log.take("call_0") is None


def test_attached_tool_log_data_is_dropped_when_the_tool_errors():
    tool_log = ToolLog()
    _, session, publisher = _events(tool_log=tool_log)
    tool_log.attach("call_0", {"text": "x"})
    session.handlers["function_tools_executed"](
        _tools_executed(("search_knowledge", "{}", "boom", True, 100.0, 100.2))
    )
    assert publisher.events[0].result is None
    assert tool_log.take("call_0") is None


def test_close_publishes_completed_with_usage_without_waiting_for_shutdown():
    usage = [STTModelUsage(provider="deepgram", model="nova", audio_duration=4)]
    events, session, publisher = _events(FakeSession(usage=usage))
    events.started(None)
    session.handlers["close"](CloseEvent(reason=CloseReason.PARTICIPANT_DISCONNECTED))
    ended = publisher.events[-1]
    assert ended.type == "call.ended"
    assert ended.status == "completed"
    assert ended.usage["stt_seconds"] == 4
    assert ended.model_usage[0].model == "nova"
    assert ended.model_usage[0].provider == "deepgram"
    assert ended.model_usage[0].quantity == 4
    assert not publisher.flushed


def test_close_publishes_ended_when_model_attribution_is_empty(monkeypatch):
    usage = [LLMModelUsage(provider="", model="", input_tokens=12, output_tokens=3)]
    events, session, publisher = _events(FakeSession(usage=usage))
    timestamps = iter((100.0, 103.0))
    monkeypatch.setattr(call_session.time, "time", lambda: next(timestamps))

    events.started(None)
    session.handlers["close"](CloseEvent(reason=CloseReason.PARTICIPANT_DISCONNECTED))

    ended = publisher.events[-1]
    assert ended.type == "call.ended"
    assert ended.status == "completed"
    assert ended.duration_ms == 3000
    assert ended.usage["llm_input_tokens"] == 12
    assert ended.usage["llm_output_tokens"] == 3
    assert ended.model_usage[0].provider == "unknown"
    assert ended.model_usage[0].model == "unknown"


def test_close_reports_recording_url_when_available():
    events, session, publisher = _events(recording_url=lambda: "s3://recordings/default/call-1.ogg")
    events.started(None)
    session.handlers["close"](CloseEvent(reason=CloseReason.PARTICIPANT_DISCONNECTED))
    assert publisher.events[-1].recording_url == "s3://recordings/default/call-1.ogg"


def test_close_without_recording_has_no_recording_url():
    for provider in (None, lambda: None):
        events, session, publisher = _events(recording_url=provider)
        events.started(None)
        session.handlers["close"](CloseEvent(reason=CloseReason.PARTICIPANT_DISCONNECTED))
        assert publisher.events[-1].recording_url is None


def test_shutdown_flushes_and_does_not_duplicate_ended():
    events, session, publisher = _events()
    events.started(None)
    session.handlers["close"](CloseEvent(reason=CloseReason.JOB_SHUTDOWN))
    asyncio.run(events.on_shutdown("done"))
    assert [e.type for e in publisher.events] == ["call.started", "call.ended"]
    assert publisher.flushed and publisher.closed


def test_shutdown_publishes_ended_when_close_never_arrives(monkeypatch):
    monkeypatch.setattr(call_session, "CLOSE_WAIT", 0.05)
    events, _, publisher = _events()
    events.started(None)
    asyncio.run(events.on_shutdown("done"))
    assert publisher.events[-1].type == "call.ended"
    assert publisher.events[-1].status == "completed"


def test_close_with_error_publishes_failed():
    events, session, publisher = _events()
    events.started(None)
    session.handlers["close"](CloseEvent(reason=CloseReason.ERROR))
    assert publisher.events[-1].status == "failed"


def test_close_before_started_publishes_no_ended():
    _, session, publisher = _events()
    session.handlers["close"](CloseEvent(reason=CloseReason.ERROR))
    assert publisher.events == []


def test_publisher_errors_never_escape():
    class BrokenPublisher(FakePublisher):
        def publish(self, event):
            raise RuntimeError("boom")

    events, session, publisher = _events(publisher=BrokenPublisher())
    events.started(None)
    session.handlers["conversation_item_added"](_item("user", "hi"))
    session.handlers["close"](CloseEvent(reason=CloseReason.JOB_SHUTDOWN))
    asyncio.run(events.on_shutdown("done"))
    assert publisher.closed


def test_flush_publishes_ended_once_and_keeps_publisher_open():
    events, session, publisher = _events()
    events.started(None)
    session.handlers["close"](CloseEvent(reason=CloseReason.USER_INITIATED))
    asyncio.run(events.flush())
    asyncio.run(events.flush())
    assert [e.type for e in publisher.events] == ["call.started", "call.ended"]
    assert publisher.flushed
    assert not publisher.closed
