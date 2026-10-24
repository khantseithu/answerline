import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import asyncpg

from .booking import Attendee, Booking, Slot, SlotUnavailableError
from .business_hours import Schedule
from .config import AgentConfig, BookAppointmentTool, Hours
from .settings import Settings

logger = logging.getLogger("answerline.agent")

DB_CONNECT_TIMEOUT = 5.0
POOL_MAX_SIZE = 2

AGENT_SQL = """
select t.id as tenant_id, a.id as agent_id
from agents a
join tenants t on t.id = a.tenant_id
where t.slug = $1 and a.slug = $2
"""
BUSY_SQL = """
select starts_at, ends_at
from bookings
where agent_id = $1 and status = 'confirmed' and ends_at is not null
  and starts_at < $3 and ends_at > $2
"""
INSERT_SQL = """
insert into bookings
  (tenant_id, agent_id, call_id, name, phone, notes, provider, starts_at, ends_at)
values
  ($1, $2, (select id from calls where tenant_id = $1 and room_name = $3),
   $4, $5, $6, 'answerline', $7, $8)
returning id
"""
CANCEL_SQL = """
update bookings set status = 'cancelled'
where id = $1 and agent_id = $2 and status = 'confirmed'
"""


def schedule_slots(hours: Hours, slot_minutes: int, start: datetime, end: datetime) -> list[Slot]:
    schedule = Schedule.from_hours(hours)
    zone = schedule.zone
    length = timedelta(minutes=slot_minutes)
    slots: list[Slot] = []
    day = start.astimezone(zone).date() - timedelta(days=1)
    while day <= end.astimezone(zone).date():
        window = schedule.window(day)
        if window is not None:
            opens, closes = window
            close_day = day + timedelta(days=1) if closes < opens else day
            slot_start = datetime.combine(day, opens, zone).astimezone(UTC)
            close_at = datetime.combine(close_day, closes, zone).astimezone(UTC)
            while slot_start + length <= close_at:
                if start <= slot_start < end:
                    slots.append(Slot(start=slot_start, end=slot_start + length))
                slot_start += length
        day += timedelta(days=1)
    return slots


@dataclass(frozen=True)
class NativeBookingProvider:
    pool: asyncpg.Pool
    tenant_id: UUID
    agent_id: UUID
    room_name: str
    hours: Hours
    slot_minutes: int

    async def availability(self, start: datetime, end: datetime) -> list[Slot]:
        slots = schedule_slots(self.hours, self.slot_minutes, start, end)
        if not slots:
            return []
        busy = await self.pool.fetch(BUSY_SQL, self.agent_id, slots[0].start, slots[-1].end)
        return [
            slot
            for slot in slots
            if not any(row["starts_at"] < slot.end and row["ends_at"] > slot.start for row in busy)
        ]

    async def create(self, start: datetime, attendee: Attendee) -> Booking:
        window = schedule_slots(
            self.hours, self.slot_minutes, start, start + timedelta(microseconds=1)
        )
        slot = next((slot for slot in window if slot.start == start), None)
        if slot is None:
            raise SlotUnavailableError
        try:
            booking_id = await self.pool.fetchval(
                INSERT_SQL,
                self.tenant_id,
                self.agent_id,
                self.room_name,
                attendee.name,
                attendee.phone,
                attendee.notes,
                slot.start,
                slot.end,
            )
        except asyncpg.ExclusionViolationError as exc:
            raise SlotUnavailableError from exc
        return Booking(id=str(booking_id), start=slot.start, end=slot.end)

    async def cancel(self, booking_id: str) -> None:
        await self.pool.execute(CANCEL_SQL, UUID(booking_id), self.agent_id)

    async def close(self) -> None:
        await self.pool.close()


async def open_booking_provider(
    config: AgentConfig, settings: Settings, agent_slug: str, room_name: str
) -> NativeBookingProvider | None:
    spec = next((tool for tool in config.tools if isinstance(tool, BookAppointmentTool)), None)
    if (
        spec is None
        or spec.provider != "answerline"
        or config.hours is None
        or not settings.database_url
    ):
        return None
    pool: asyncpg.Pool | None = None
    row = None
    try:
        pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=1,
            max_size=POOL_MAX_SIZE,
            timeout=DB_CONNECT_TIMEOUT,
        )
        row = await pool.fetchrow(AGENT_SQL, settings.tenant, agent_slug)
    except Exception:
        logger.warning("native booking unavailable for agent %s", agent_slug, exc_info=True)
    if pool is None or row is None:
        if pool is not None:
            await pool.close()
        return None
    return NativeBookingProvider(
        pool=pool,
        tenant_id=row["tenant_id"],
        agent_id=row["agent_id"],
        room_name=room_name,
        hours=config.hours,
        slot_minutes=spec.slot_minutes,
    )
