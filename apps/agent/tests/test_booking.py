import asyncio
from contextlib import nullcontext
from datetime import datetime, timedelta
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
    def with_filler(self, *args, **kwargs):
        return nullcontext()


class FakeProvider:
    def __init__(self, slots=(), fail=None):
        self.slots = list(slots)
        self.fail = fail
        self.windows = []
        self.created = []
        self.cancelled = []

    async def availability(self, start, end):
        self.windows.append((start, end))
        if self.fail:
            error, self.fail = self.fail, None
            raise error
        return self.slots

    async def create(self, start, attendee):
        self.created.append((start, attendee))
        if self.fail:
            raise self.fail
        return Booking(id=f"b{len(self.created)}", start=start, end=start + timedelta(minutes=30))

    async def cancel(self, booking_id):
        self.cancelled.append(booking_id)


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    monkeypatch.setattr(booking, "datetime", FrozenDatetime)


def tools(provider):
    check, book, cancel = build_booking_tools(
        provider, "America/New_York", Settings(tool_timeout_seconds=1, tool_retries=1)
    )
    return check, book, cancel


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
        "cancel_appointment",
    ]
    assert set(schemas[1]["parameters"]["required"]) == {"start", "name", "phone"}
    assert set(schemas[1]["parameters"]["properties"]) == {"start", "name", "phone", "notes"}


def test_availability_searches_local_days_from_now_and_returns_sorted_local_times():
    provider = FakeProvider([slot(15), slot(9), slot(15, day=23)])
    check, _, _ = tools(provider)
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
    check, _, _ = tools(provider)
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
    check, _, _ = tools(provider)
    with pytest.raises(ToolError):
        asyncio.run(check(FakeContext(), start_date, end_date))
    assert provider.windows == []


def test_availability_retries_transient_failure():
    provider = FakeProvider([slot(9)], fail=ConnectionError())
    check, _, _ = tools(provider)
    result = asyncio.run(check(FakeContext(), "2026-10-24"))
    assert len(provider.windows) == 2
    assert result["slots"] == ["2026-10-24T09:00:00-04:00"]


def test_book_normalizes_details_and_cancels_only_same_call_bookings():
    async def scenario():
        provider = FakeProvider()
        _, book, cancel = tools(provider)
        result = await book(
            FakeContext(), "2026-10-24T09:00:00", "﻿ Alex \u0085", " +15555550123 ", "\n"
        )
        start, attendee = provider.created[0]
        assert start == datetime(2026, 10, 24, 9, tzinfo=ZONE)
        assert (attendee.name, attendee.phone, attendee.notes) == ("Alex", "+15555550123", None)
        assert result == {
            "booking_id": "b1",
            "start": "2026-10-24T09:00:00-04:00",
            "end": "2026-10-24T09:30:00-04:00",
            "status": "confirmed",
        }
        with pytest.raises(ToolError, match="booked during this call"):
            await cancel(FakeContext(), "someone-else")
        assert await cancel(FakeContext(), "b1") == {"booking_id": "b1", "status": "cancelled"}
        with pytest.raises(ToolError, match="booked during this call"):
            await cancel(FakeContext(), "b1")
        assert provider.cancelled == ["b1"]

    asyncio.run(scenario())


def test_bookings_are_isolated_per_call():
    async def scenario():
        provider = FakeProvider()
        _, book, _ = tools(provider)
        _, _, other_cancel = tools(provider)
        await book(FakeContext(), "2026-10-24T09:00:00-04:00", "Alex", "+15555550123")
        with pytest.raises(ToolError, match="booked during this call"):
            await other_cancel(FakeContext(), "b1")

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
    _, book, _ = tools(provider)
    with pytest.raises(ToolError):
        asyncio.run(book(FakeContext(), start, name, phone))
    assert provider.created == []


def test_taken_slot_asks_for_another_time():
    provider = FakeProvider(fail=SlotUnavailableError())
    _, book, _ = tools(provider)
    with pytest.raises(ToolError, match="no longer available"):
        asyncio.run(book(FakeContext(), "2026-10-24T09:00:00", "Alex", "+15555550123"))


def test_create_is_not_retried_after_transient_failure():
    provider = FakeProvider(fail=ConnectionError())
    _, book, _ = tools(provider)
    with pytest.raises(ToolError) as caught:
        asyncio.run(book(FakeContext(), "2026-10-24T09:00:00", "Alex", "+15555550123"))
    assert str(caught.value) == UNAVAILABLE
    assert len(provider.created) == 1
