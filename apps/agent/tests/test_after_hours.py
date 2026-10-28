import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from answerline_agent import business_hours
from answerline_agent.after_hours import AfterHours
from answerline_agent.config import Hours
from answerline_agent.settings import Settings

SETTINGS = Settings()


class FakeHandle:
    async def wait_for_playout(self):
        return None


class FakeSession:
    def __init__(self):
        self.said = []

    def on(self, name, handler):
        return handler

    def say(self, text, **kwargs):
        self.said.append(text)
        return FakeHandle()

    def generate_reply(self, *, instructions, **kwargs):
        self.said.append(("generated", instructions, kwargs))
        return FakeHandle()

    async def aclose(self):
        return None


class FakeTransfer:
    def __init__(self, *, can_transfer=True, fail=False):
        self.can_transfer = can_transfer
        self.fail = fail
        self.calls = 0

    async def transfer(self):
        self.calls += 1
        if self.fail:
            raise RuntimeError("refer rejected")


def at(monkeypatch, instant: str):
    now = datetime.fromisoformat(instant)
    monkeypatch.setattr(
        business_hours, "datetime", SimpleNamespace(now=lambda zone: now.astimezone(zone))
    )


def hours(after_hours: str = "voicemail") -> Hours:
    return Hours(
        timezone="America/New_York",
        weekdays="09:00-18:00",
        after_hours=after_hours,
        holidays=[{"date": "2026-12-25", "name": "Christmas Day"}],
    )


OPEN = "2026-10-23T15:00:00+00:00"
CLOSED = "2026-10-23T23:30:00+00:00"
CHRISTMAS = "2026-12-25T15:00:00+00:00"


def greet(plan: AfterHours, transfer=None) -> list[str]:
    session = FakeSession()
    asyncio.run(plan.greet(session, "Hello, how can I help?", transfer))
    return session.said


def test_open_calls_get_the_normal_greeting(monkeypatch):
    at(monkeypatch, OPEN)
    plan = AfterHours(hours(), "Bright Smile Dental", SETTINGS)
    assert plan.mode is None
    assert plan.instructions() is None
    assert not plan.takes_voicemail
    assert greet(plan) == ["Hello, how can I help?"]


def test_no_hours_means_always_open():
    plan = AfterHours(None, "Clinic", SETTINGS)
    assert plan.mode is None
    assert greet(plan) == ["Hello, how can I help?"]


def test_closed_voicemail_greets_with_closed_notice(monkeypatch):
    at(monkeypatch, CLOSED)
    plan = AfterHours(hours("voicemail"), "Bright Smile Dental", SETTINGS)
    assert plan.mode == "voicemail"
    assert plan.takes_voicemail
    assert "take_voicemail" in plan.instructions()
    [said] = greet(plan)
    assert said.startswith("Thanks for calling Bright Smile Dental. We're closed right now")


def test_default_voicemail_greeting_makes_no_callback_promise():
    assert SETTINGS.after_hours_voicemail_message == (
        "Thanks for calling {name}. We're closed right now, but I can take a message for the team."
    )
    lowered = SETTINGS.after_hours_voicemail_message.lower()
    for promise in ("get back to you", "call you back", "call you", "contact you"):
        assert promise not in lowered


def test_closed_holiday_names_the_holiday(monkeypatch):
    at(monkeypatch, CHRISTMAS)
    plan = AfterHours(hours("voicemail"), "Clinic", SETTINGS)
    assert plan.holiday == "Christmas Day"
    assert "closed right now for Christmas Day" in plan.instructions()


def test_closed_answer_keeps_greeting_and_tells_the_agent(monkeypatch):
    at(monkeypatch, CLOSED)
    plan = AfterHours(hours("answer"), "Clinic", SETTINGS)
    assert not plan.takes_voicemail
    assert "nobody is available" in plan.instructions()
    assert greet(plan) == ["Hello, how can I help?"]


def test_closed_transfer_transfers_sip_callers(monkeypatch):
    at(monkeypatch, CLOSED)
    plan = AfterHours(hours("transfer"), "Clinic", SETTINGS)
    transfer = FakeTransfer()
    said = greet(plan, transfer)
    assert transfer.calls == 1
    assert said == [SETTINGS.after_hours_transfer_message.replace("{name}", "Clinic")]


@pytest.mark.parametrize("transfer", [None, FakeTransfer(can_transfer=False)])
def test_closed_transfer_falls_back_to_voicemail_without_sip(monkeypatch, transfer):
    at(monkeypatch, CLOSED)
    plan = AfterHours(hours("transfer"), "Clinic", SETTINGS)
    assert plan.takes_voicemail
    said = greet(plan, transfer)
    assert said == [SETTINGS.after_hours_voicemail_message.replace("{name}", "Clinic")]
    if transfer is not None:
        assert transfer.calls == 0


def test_failed_transfer_offers_a_message(monkeypatch):
    at(monkeypatch, CLOSED)
    plan = AfterHours(hours("transfer"), "Clinic", SETTINGS)
    transfer = FakeTransfer(fail=True)
    said = greet(plan, transfer)
    assert transfer.calls == 1
    assert said[-1] == SETTINGS.after_hours_transfer_failed_message


def test_localized_agents_have_the_llm_speak_after_hours_messages(monkeypatch):
    at(monkeypatch, CLOSED)
    session = FakeSession()
    plan = AfterHours(hours("voicemail"), "Clinic", SETTINGS, localize=True)

    asyncio.run(plan.greet(session, "Hola", None))

    [(kind, instructions, kwargs)] = session.said
    assert kind == "generated"
    assert "in the language they are using" in instructions
    assert "Thanks for calling Clinic. We're closed right now" in instructions
    assert kwargs == {"tool_choice": "none"}
