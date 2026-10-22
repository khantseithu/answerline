import asyncio
from types import SimpleNamespace

from answerline_agent import call_session
from answerline_agent.call_session import CallSessionEvents
from livekit import rtc
from livekit.agents.llm import AgentHandoff, ChatMessage
from livekit.agents.metrics import STTModelUsage
from livekit.agents.voice.events import CloseEvent, CloseReason, ConversationItemAddedEvent


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


def _events(session=None, publisher=None):
    session = session or FakeSession()
    publisher = publisher or FakePublisher()
    events = CallSessionEvents(
        session=session,
        publisher=publisher,
        room_name="call-1",
        tenant="default",
        agent="bright-smile-dental",
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


def test_close_publishes_completed_with_usage_without_waiting_for_shutdown():
    usage = [STTModelUsage(provider="deepgram", model="nova", audio_duration=4)]
    events, session, publisher = _events(FakeSession(usage=usage))
    events.started(None)
    session.handlers["close"](CloseEvent(reason=CloseReason.PARTICIPANT_DISCONNECTED))
    ended = publisher.events[-1]
    assert ended.type == "call.ended"
    assert ended.status == "completed"
    assert ended.usage["stt_seconds"] == 4
    assert not publisher.flushed


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
