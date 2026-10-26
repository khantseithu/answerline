import asyncio
import json
import os
import uuid
from datetime import UTC, datetime

import asyncpg
import pytest
from answerline_agent.booking import Attendee, SlotUnavailableError
from answerline_agent.config import AgentConfig, BookAppointmentTool, Hours
from answerline_agent.native_booking import open_booking_provider, schedule_slots
from answerline_agent.settings import Settings

DATABASE_URL = os.environ.get("DATABASE_URL")
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


def utc(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=UTC)


def starts(hours: Hours, minutes: int, start: str, end: str) -> list[str]:
    return [
        slot.start.strftime("%Y-%m-%dT%H:%M")
        for slot in schedule_slots(hours, minutes, utc(start), utc(end))
    ]


def test_slots_follow_weekday_hours_and_skip_closed_weekends():
    hours = Hours(timezone="America/New_York", weekdays="09:00-10:45")
    assert starts(hours, 30, "2026-10-23T00:00", "2026-10-26T00:00") == [
        "2026-10-23T13:00",
        "2026-10-23T13:30",
        "2026-10-23T14:00",
    ]


def test_slots_respect_search_bounds():
    hours = Hours(timezone="America/New_York", weekdays="09:00-12:00")
    assert starts(hours, 60, "2026-10-23T14:00", "2026-10-23T15:00") == ["2026-10-23T14:00"]


def test_overnight_slots_carry_into_the_next_day():
    hours = Hours(timezone="UTC", weekdays="22:00-02:00", weekends="10:00-11:00")
    assert starts(hours, 60, "2026-10-24T00:00", "2026-10-25T00:00") == [
        "2026-10-24T00:00",
        "2026-10-24T01:00",
        "2026-10-24T10:00",
    ]


def test_slots_use_elapsed_time_across_dst_changes():
    hours = Hours(timezone="America/New_York", weekdays="09:00-17:00", weekends="00:00-04:00")
    assert starts(hours, 60, "2026-11-01T00:00", "2026-11-02T00:00") == [
        "2026-11-01T04:00",
        "2026-11-01T05:00",
        "2026-11-01T06:00",
        "2026-11-01T07:00",
        "2026-11-01T08:00",
    ]


def test_slots_skip_closed_holidays_and_use_special_hours():
    hours = Hours(
        timezone="UTC",
        weekdays="09:00-11:00",
        holidays=[{"date": "2026-12-24", "hours": "09:00-10:00"}, {"date": "2026-12-25"}],
    )
    assert starts(hours, 60, "2026-12-24T00:00", "2026-12-26T00:00") == ["2026-12-24T09:00"]


def agent_config(provider: str = "answerline") -> AgentConfig:
    return AgentConfig(
        name="Clinic",
        greeting="Hello",
        instructions="Be brief.",
        models={
            "stt": "deepgram/nova-3",
            "llm": {"primary": "anthropic/claude-sonnet-4-6"},
            "tts": "cartesia/sonic-3",
        },
        tools=[BookAppointmentTool(builtin="book_appointment", provider=provider)],
        hours=Hours(timezone="America/New_York", weekdays="09:00-11:00"),
    )


async def _scenario() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    tenant = f"test-{uuid.uuid4()}"
    room = f"room-{uuid.uuid4()}"
    provider = None
    try:
        tenant_id = await conn.fetchval(
            "insert into tenants (slug, name) values ($1, $1) returning id", tenant
        )
        config = agent_config()
        agent_id = await conn.fetchval(
            "insert into agents (tenant_id, slug, name, config) "
            "values ($1, 'clinic', 'Clinic', $2) returning id",
            tenant_id,
            json.dumps(config.model_dump(mode="json")),
        )
        call_id = await conn.fetchval(
            "insert into calls (tenant_id, agent_id, channel, room_name) "
            "values ($1, $2, 'web', $3) returning id",
            tenant_id,
            agent_id,
            room,
        )
        settings = Settings(database_url=DATABASE_URL, tenant="deployment")
        assert (
            await open_booking_provider(config, settings, "missing", room, tenant_slug=tenant)
            is None
        )
        assert (
            await open_booking_provider(
                agent_config("cal_com"), settings, "clinic", room, tenant_slug=tenant
            )
            is None
        )
        provider = await open_booking_provider(config, settings, "clinic", room, tenant_slug=tenant)
        assert provider is not None
        monday = (utc("2026-10-26T00:00"), utc("2026-10-27T00:00"))
        assert len(await provider.availability(*monday)) == 4

        alex = Attendee(name="Alex", phone="+15555550123", notes="Cleaning")
        booking = await provider.create(utc("2026-10-26T13:30"), alex)
        assert (booking.start, booking.end) == (utc("2026-10-26T13:30"), utc("2026-10-26T14:00"))
        row = await conn.fetchrow("select * from bookings where id = $1", uuid.UUID(booking.id))
        assert (row["call_id"], row["provider"], row["status"]) == (
            call_id,
            "answerline",
            "confirmed",
        )
        assert (row["name"], row["phone"], row["notes"]) == ("Alex", "+15555550123", "Cleaning")
        open_starts = [slot.start for slot in await provider.availability(*monday)]
        assert utc("2026-10-26T13:30") not in open_starts
        assert len(open_starts) == 3

        for start in ("2026-10-26T13:30", "2026-10-26T13:15", "2026-10-26T16:00"):
            with pytest.raises(SlotUnavailableError):
                await provider.create(utc(start), alex)

        results = await asyncio.gather(
            provider.create(utc("2026-10-26T14:00"), alex),
            provider.create(utc("2026-10-26T14:00"), alex),
            return_exceptions=True,
        )
        assert sorted(type(result).__name__ for result in results) == [
            "Booking",
            "SlotUnavailableError",
        ]

        await provider.cancel(booking.id)
        assert utc("2026-10-26T13:30") in [
            slot.start for slot in await provider.availability(*monday)
        ]
    finally:
        if provider is not None:
            await provider.close()
        await conn.execute("delete from tenants where slug = $1", tenant)
        await conn.close()


@needs_db
def test_native_provider_books_cancels_and_prevents_double_booking():
    asyncio.run(_scenario())
