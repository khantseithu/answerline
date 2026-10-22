import asyncio
from types import SimpleNamespace

import pytest
from answerline_agent import call_limits
from answerline_agent.call_limits import (
    DEFAULT_DRAIN_TIMEOUT,
    DRAIN_MARGIN,
    CallLifecycle,
    drain_timeout,
    wrap_up_delay,
    wrap_up_lead,
)
from answerline_agent.settings import Settings
from livekit.agents.voice.events import UserStateChangedEvent

LIMIT_ENV = (
    "MAX_CALL_DURATION_SECONDS",
    "IDLE_TIMEOUT_SECONDS",
    "DRAIN_TIMEOUT_SECONDS",
    "CALL_WRAP_UP_MESSAGE",
    "IDLE_CHECK_IN_MESSAGE",
)


def _settings(monkeypatch, **env):
    for key in LIMIT_ENV:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, str(value))
    return Settings()


def test_limit_defaults(monkeypatch):
    settings = _settings(monkeypatch)
    assert settings.max_call_duration_seconds == 900
    assert settings.idle_timeout_seconds == 60
    assert settings.drain_timeout_seconds is None
    assert settings.call_wrap_up_message
    assert settings.idle_check_in_message


def test_limit_settings_read_environment(monkeypatch):
    settings = _settings(
        monkeypatch,
        MAX_CALL_DURATION_SECONDS=30,
        IDLE_TIMEOUT_SECONDS=0,
        DRAIN_TIMEOUT_SECONDS=45,
        CALL_WRAP_UP_MESSAGE="Bye.",
    )
    assert settings.max_call_duration_seconds == 30
    assert settings.idle_timeout_seconds == 0
    assert settings.drain_timeout_seconds == 45
    assert settings.call_wrap_up_message == "Bye."


def test_negative_limits_are_rejected(monkeypatch):
    with pytest.raises(ValueError):
        _settings(monkeypatch, MAX_CALL_DURATION_SECONDS=-1)


def test_wrap_up_delay():
    assert wrap_up_delay(0) is None
    assert wrap_up_delay(900) == 890
    assert wrap_up_delay(20) == 10
    assert wrap_up_delay(6) == 3
    assert wrap_up_lead(900) == call_limits.WRAP_UP_LEAD
    assert wrap_up_lead(6) == 3


def test_drain_timeout_follows_max_call_duration(monkeypatch):
    assert drain_timeout(_settings(monkeypatch)) == 900 + DRAIN_MARGIN
    assert drain_timeout(_settings(monkeypatch, MAX_CALL_DURATION_SECONDS=0)) == (
        DEFAULT_DRAIN_TIMEOUT
    )
    assert drain_timeout(_settings(monkeypatch, DRAIN_TIMEOUT_SECONDS=30)) == 30


class FakeHandle:
    def __init__(self, hang):
        self.hang = hang

    async def wait_for_playout(self):
        if self.hang:
            await asyncio.sleep(3600)


class FakeSession:
    def __init__(self, log, *, hang_speech=False, hang_close=False):
        self.log = log
        self.handlers = {}
        self.said = []
        self.hang_speech = hang_speech
        self.hang_close = hang_close

    def on(self, name, handler):
        self.handlers[name] = handler

    def say(self, text, **kwargs):
        self.said.append((text, kwargs))
        self.log.append("say")
        return FakeHandle(self.hang_speech)

    async def aclose(self):
        self.log.append("aclose")
        if self.hang_close:
            await asyncio.sleep(3600)


class FakeEvents:
    def __init__(self, log):
        self.log = log

    async def flush(self):
        self.log.append("flush")


class FakeJob:
    def __init__(self, log, *, hang_delete=False):
        self.log = log
        self.hang_delete = hang_delete
        self.reasons = []
        self.shutdown_called = asyncio.Event()

    async def delete_room(self):
        self.log.append("delete_room")
        if self.hang_delete:
            await asyncio.sleep(3600)

    def shutdown(self, reason):
        self.log.append("shutdown")
        self.reasons.append(reason)
        self.shutdown_called.set()


def _lifecycle(monkeypatch, env=None, *, hang_speech=False, hang_close=False, hang_delete=False):
    log = []
    session = FakeSession(log, hang_speech=hang_speech, hang_close=hang_close)
    job = FakeJob(log, hang_delete=hang_delete)
    lifecycle = CallLifecycle(
        session=session,
        events=FakeEvents(log),
        job=job,
        settings=_settings(monkeypatch, **(env or {})),
    )
    return lifecycle, session, job, log


async def _wait(job, timeout=2.0):
    await asyncio.wait_for(job.shutdown_called.wait(), timeout)


def _user_state(new_state):
    return UserStateChangedEvent(old_state="listening", new_state=new_state)


def test_session_close_flushes_before_shutdown(monkeypatch):
    async def run():
        _, session, job, log = _lifecycle(monkeypatch)
        session.handlers["close"](SimpleNamespace())
        await _wait(job)
        return job, log

    job, log = asyncio.run(run())
    assert log == ["aclose", "flush", "delete_room", "shutdown"]
    assert job.reasons == ["session closed"]


def test_end_is_idempotent(monkeypatch):
    async def run():
        lifecycle, _, job, log = _lifecycle(monkeypatch)
        lifecycle.end("one")
        lifecycle.end("two")
        await _wait(job)
        await asyncio.sleep(0.05)
        return job, log

    job, log = asyncio.run(run())
    assert job.reasons == ["one"]
    assert log.count("flush") == 1


def test_caller_disconnect_ends_call(monkeypatch):
    class Room:
        def __init__(self):
            self.handlers = {}

        def on(self, name, handler):
            self.handlers[name] = handler

    async def run():
        lifecycle, _, job, _ = _lifecycle(monkeypatch)
        room = Room()
        lifecycle.watch_caller(room, SimpleNamespace(identity="caller"))
        room.handlers["participant_disconnected"](SimpleNamespace(identity="someone-else"))
        await asyncio.sleep(0.05)
        assert not job.shutdown_called.is_set()
        room.handlers["participant_disconnected"](SimpleNamespace(identity="caller"))
        await _wait(job)
        return job

    assert asyncio.run(run()).reasons == ["caller disconnected"]


def test_watch_caller_ignores_missing_participant(monkeypatch):
    lifecycle, _, _, _ = _lifecycle(monkeypatch)
    lifecycle.watch_caller(SimpleNamespace(on=lambda *a: pytest.fail("subscribed")), None)


def test_max_duration_says_wrap_up_then_ends(monkeypatch):
    monkeypatch.setattr(call_limits, "wrap_up_delay", lambda *a, **k: 0.05)

    async def run():
        lifecycle, session, job, log = _lifecycle(
            monkeypatch, {"MAX_CALL_DURATION_SECONDS": 20, "IDLE_TIMEOUT_SECONDS": 0}
        )
        lifecycle.start()
        assert not job.shutdown_called.is_set()
        await _wait(job)
        return session, job, log

    session, job, log = asyncio.run(run())
    assert log == ["say", "aclose", "flush", "delete_room", "shutdown"]
    assert session.said == [(Settings().call_wrap_up_message, {"allow_interruptions": False})]
    assert job.reasons == ["max call duration"]


def test_max_duration_disabled_never_ends(monkeypatch):
    async def run():
        lifecycle, _, job, _ = _lifecycle(monkeypatch, {"MAX_CALL_DURATION_SECONDS": 0})
        lifecycle.start()
        await asyncio.sleep(0.1)
        return job

    assert not asyncio.run(run()).shutdown_called.is_set()


def test_wrap_up_wait_is_bounded(monkeypatch):
    monkeypatch.setattr(call_limits, "wrap_up_lead", lambda *a, **k: 0.05)
    monkeypatch.setattr(call_limits, "wrap_up_delay", lambda *a, **k: 0.0)

    async def run():
        lifecycle, _, job, log = _lifecycle(
            monkeypatch, {"MAX_CALL_DURATION_SECONDS": 5}, hang_speech=True
        )
        lifecycle.start()
        await _wait(job)
        return log

    assert asyncio.run(run()) == ["say", "aclose", "flush", "delete_room", "shutdown"]


def test_hung_close_and_delete_room_are_bounded(monkeypatch):
    monkeypatch.setattr(call_limits, "SESSION_CLOSE_WAIT", 0.05)
    monkeypatch.setattr(call_limits, "DELETE_ROOM_WAIT", 0.05)

    async def run():
        lifecycle, _, job, log = _lifecycle(monkeypatch, hang_close=True, hang_delete=True)
        lifecycle.end("done")
        await _wait(job)
        return log

    assert asyncio.run(run()) == ["aclose", "flush", "delete_room", "shutdown"]


def test_idle_checks_in_then_ends_after_grace(monkeypatch):
    monkeypatch.setattr(call_limits, "IDLE_GRACE", 0.05)

    async def run():
        _, session, job, log = _lifecycle(monkeypatch, {"MAX_CALL_DURATION_SECONDS": 0})
        session.handlers["user_state_changed"](_user_state("away"))
        await _wait(job)
        return session, job, log

    session, job, log = asyncio.run(run())
    assert session.said == [(Settings().idle_check_in_message, {})]
    assert log == ["say", "aclose", "flush", "delete_room", "shutdown"]
    assert job.reasons == ["idle timeout"]


def test_caller_reply_cancels_idle_end(monkeypatch):
    monkeypatch.setattr(call_limits, "IDLE_GRACE", 0.1)

    async def run():
        _, session, job, _ = _lifecycle(monkeypatch)
        session.handlers["user_state_changed"](_user_state("away"))
        await asyncio.sleep(0.03)
        session.handlers["user_state_changed"](_user_state("speaking"))
        await asyncio.sleep(0.2)
        return job

    assert not asyncio.run(run()).shutdown_called.is_set()


def test_idle_disabled_ignores_away(monkeypatch):
    async def run():
        _, session, job, _ = _lifecycle(monkeypatch, {"IDLE_TIMEOUT_SECONDS": 0})
        session.handlers["user_state_changed"](_user_state("away"))
        await asyncio.sleep(0.05)
        return session, job

    session, job = asyncio.run(run())
    assert session.said == []
    assert not job.shutdown_called.is_set()
