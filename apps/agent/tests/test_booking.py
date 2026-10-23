import asyncio
import time
from contextlib import nullcontext
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from answerline_agent import booking
from answerline_agent.booking import (
    Booking,
    Slot,
    SlotUnavailableError,
    build_booking_tools,
)
from answerline_agent.settings import Settings
from answerline_agent.tool_policy import UNAVAILABLE
from livekit.agents import ToolError, llm

ZONE = ZoneInfo("America/New_York")
NOW = datetime(2026, 10, 23, 14, 0, tzinfo=ZONE)


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz)


class FakeContext:
    def __init__(self, items=None):
        self.session = SimpleNamespace(history=SimpleNamespace(items=items or []))

    def with_filler(self, *args, **kwargs):
        return nullcontext()

    def says(self, role="user", *, earlier=False):
        created_at = time.time() + (-1 if earlier else 1)
        message = SimpleNamespace(type="message", role=role, created_at=created_at)
        self.session.history.items.append(message)


class FakeProvider:
    def __init__(self, slots=None, fail=None, fail_create=None):
        self.slots = slots
        self.fail = fail
        self.fail_create = fail_create
        self.windows = []
        self.created = []
        self.cancelled = []

    async def availability(self, start, end):
        self.windows.append((start, end))
        if self.fail:
            error, self.fail = self.fail, None
            raise error
        if self.slots is None:
            return [Slot(start=start, end=start + timedelta(minutes=30))]
        return self.slots

    async def create(self, start, attendee):
        self.created.append((start, attendee))
        if self.fail_create:
            raise self.fail_create
        return Booking(id=f"b{len(self.created)}", start=start, end=start + timedelta(minutes=30))

    async def cancel(self, booking_id):
        self.cancelled.append(booking_id)


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    monkeypatch.setattr(booking, "datetime", FrozenDatetime)


def tools(provider):
    check, book, confirm, cancel = build_booking_tools(
        provider, "America/New_York", Settings(tool_timeout_seconds=1, tool_retries=1)
    )
    return check, book, confirm, cancel


def slot(hour, day=24):
    start = datetime(2026, 10, day, hour, tzinfo=ZONE)
    return Slot(start=start, end=start + timedelta(minutes=30))


def test_tool_schemas_hide_context():
    schemas = [
        llm.utils.build_legacy_openai_schema(tool)["function"] for tool in tools(FakeProvider())
    ]
    assert [schema["name"] for schema in schemas] == [
        "check_availability",
        "book_appointment",
        "confirm_booking",
        "cancel_appointment",
    ]
    assert set(schemas[1]["parameters"]["required"]) == {"start", "name", "phone"}
    assert set(schemas[1]["parameters"]["properties"]) == {"start", "name", "phone", "notes"}
    assert schemas[2]["parameters"]["required"] == ["confirmation_id"]


def test_availability_searches_local_days_from_now_and_returns_sorted_local_times():
    provider = FakeProvider([slot(15), slot(9), slot(15, day=23)])
    check, *_ = tools(provider)
    result = asyncio.run(check(FakeContext(), "2026-10-23", "2026-10-24"))
    assert provider.windows == [(NOW, datetime(2026, 10, 25, tzinfo=ZONE))]
    assert result == {
        "timezone": "America/New_York",
        "slots": [
            "2026-10-23T15:00:00-04:00",
            "2026-10-24T09:00:00-04:00",
            "2026-10-24T15:00:00-04:00",
        ],
        "more_available": False,
    }


def test_availability_caps_slots():
    provider = FakeProvider([slot(0, day=24) for _ in range(booking.MAX_SLOTS + 1)])
    check, *_ = tools(provider)
    result = asyncio.run(check(FakeContext(), "2026-10-24"))
    assert len(result["slots"]) == booking.MAX_SLOTS
    assert result["more_available"] is True


@pytest.mark.parametrize(
    ("start_date", "end_date"),
    [
        ("tomorrow", None),
        ("2026-10-25", "2026-10-24"),
        ("2026-10-24", "2026-11-07"),
        ("2026-10-22", None),
    ],
)
def test_invalid_availability_ranges_do_not_reach_provider(start_date, end_date):
    provider = FakeProvider()
    check, *_ = tools(provider)
    with pytest.raises(ToolError):
        asyncio.run(check(FakeContext(), start_date, end_date))
    assert provider.windows == []


def test_availability_retries_transient_failure():
    provider = FakeProvider([slot(9)], fail=ConnectionError())
    check, *_ = tools(provider)
    result = asyncio.run(check(FakeContext(), "2026-10-24"))
    assert len(provider.windows) == 2
    assert result["slots"] == ["2026-10-24T09:00:00-04:00"]


def test_book_prepares_normalized_details_without_writing():
    provider = FakeProvider()
    _, book, _, _ = tools(provider)
    result = asyncio.run(
        book(FakeContext(), "2026-10-24T09:00:00", "\ufeff Alex \u0085", " +15555550123 ", "\n")
    )
    assert result == {
        "confirmation_id": "c1",
        "start": "2026-10-24T09:00:00-04:00",
        "name": "Alex",
        "phone": "+15555550123",
        "notes": None,
        "status": "awaiting_confirmation",
    }
    target = datetime(2026, 10, 24, 9, tzinfo=ZONE)
    assert provider.windows == [(target, target + timedelta(microseconds=1))]
    assert provider.created == []


def test_confirm_requires_the_caller_to_speak_after_the_read_back():
    async def scenario():
        provider = FakeProvider()
        _, book, confirm, cancel = tools(provider)
        context = FakeContext()
        context.says(earlier=True)
        prepared = await book(context, "2026-10-24T09:00:00", "Alex", "+15555550123", "Cleaning")
        with pytest.raises(ToolError, match="wait for them to confirm"):
            await confirm(context, prepared["confirmation_id"])
        context.says(role="assistant")
        with pytest.raises(ToolError, match="wait for them to confirm"):
            await confirm(context, prepared["confirmation_id"])
        assert provider.created == []
        context.says()
        result = await confirm(context, prepared["confirmation_id"])
        start, attendee = provider.created[0]
        assert start == datetime(2026, 10, 24, 9, tzinfo=ZONE)
        assert (attendee.name, attendee.phone, attendee.notes) == (
            "Alex",
            "+15555550123",
            "Cleaning",
        )
        assert result == {
            "booking_id": "b1",
            "start": "2026-10-24T09:00:00-04:00",
            "end": "2026-10-24T09:30:00-04:00",
            "status": "confirmed",
        }
        with pytest.raises(ToolError, match="Unknown confirmation_id"):
            await confirm(context, prepared["confirmation_id"])
        with pytest.raises(ToolError, match="booked during this call"):
            await cancel(context, "someone-else")
        assert await cancel(context, "b1") == {"booking_id": "b1", "status": "cancelled"}
        with pytest.raises(ToolError, match="booked during this call"):
            await cancel(context, "b1")
        assert provider.cancelled == ["b1"]

    asyncio.run(scenario())


def test_confirmations_and_bookings_are_isolated_per_call():
    async def scenario():
        provider = FakeProvider()
        _, book, confirm, _ = tools(provider)
        _, _, other_confirm, other_cancel = tools(provider)
        context = FakeContext()
        prepared = await book(context, "2026-10-24T09:00:00-04:00", "Alex", "+15555550123")
        context.says()
        with pytest.raises(ToolError, match="Unknown confirmation_id"):
            await other_confirm(context, prepared["confirmation_id"])
        await confirm(context, prepared["confirmation_id"])
        with pytest.raises(ToolError, match="booked during this call"):
            await other_cancel(context, "b1")

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("start", "name", "phone"),
    [
        ("Saturday at nine", "Alex", "+15555550123"),
        ("2026-10-23T13:00:00-04:00", "Alex", "+15555550123"),
        ("2026-10-24T09:00:00", "\u0085 ", "+15555550123"),
        ("2026-10-24T09:00:00", "Alex", "\n"),
    ],
)
def test_invalid_bookings_do_not_reach_provider(start, name, phone):
    provider = FakeProvider()
    _, book, _, _ = tools(provider)
    with pytest.raises(ToolError):
        asyncio.run(book(FakeContext(), start, name, phone))
    assert provider.windows == []


def test_book_refuses_a_time_that_is_not_open():
    provider = FakeProvider([slot(10)])
    _, book, _, _ = tools(provider)
    with pytest.raises(ToolError, match="no longer available"):
        asyncio.run(book(FakeContext(), "2026-10-24T09:00:00", "Alex", "+15555550123"))


async def book_and_confirm(provider):
    _, book, confirm, _ = tools(provider)
    context = FakeContext()
    prepared = await book(context, "2026-10-24T09:00:00", "Alex", "+15555550123")
    context.says()
    return await confirm(context, prepared["confirmation_id"])


def test_slot_taken_before_confirmation_asks_for_another_time():
    provider = FakeProvider(fail_create=SlotUnavailableError())
    with pytest.raises(ToolError, match="no longer available"):
        asyncio.run(book_and_confirm(provider))


def test_create_is_not_retried_after_transient_failure():
    provider = FakeProvider(fail_create=ConnectionError())
    with pytest.raises(ToolError) as caught:
        asyncio.run(book_and_confirm(provider))
    assert str(caught.value) == UNAVAILABLE
    assert len(provider.created) == 1
