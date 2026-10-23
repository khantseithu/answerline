from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Annotated, Protocol
from zoneinfo import ZoneInfo

from livekit.agents import RunContext, ToolError, llm
from pydantic import Field

from .call_events import LEAD_WHITESPACE
from .settings import Settings
from .tool_policy import execute_tool

MAX_SEARCH_DAYS = 14
MAX_SLOTS = 20


@dataclass(frozen=True)
class Slot:
    start: datetime
    end: datetime


@dataclass(frozen=True)
class Attendee:
    name: str
    phone: str
    notes: str | None = None


@dataclass(frozen=True)
class Booking:
    id: str
    start: datetime
    end: datetime


class SlotUnavailableError(Exception):
    pass


class BookingProvider(Protocol):
    async def availability(self, start: datetime, end: datetime) -> list[Slot]: ...

    async def create(self, start: datetime, attendee: Attendee) -> Booking: ...

    async def cancel(self, booking_id: str) -> None: ...


def build_booking_tools(
    provider: BookingProvider, timezone: str, settings: Settings | None = None
) -> list[llm.FunctionTool]:
    settings = settings or Settings()
    zone = ZoneInfo(timezone)
    booked: set[str] = set()

    def local(value: datetime) -> str:
        return value.astimezone(zone).isoformat()

    async def check_availability(
        context: RunContext,
        start_date: Annotated[str, Field(description="First day to search, as YYYY-MM-DD")],
        end_date: Annotated[
            str | None,
            Field(description="Last day to search, as YYYY-MM-DD. Defaults to start_date."),
        ] = None,
    ) -> dict[str, object]:
        try:
            first = date.fromisoformat(start_date)
            last = date.fromisoformat(end_date) if end_date else first
        except ValueError as exc:
            raise ToolError("Provide dates as YYYY-MM-DD.") from exc
        if last < first or (last - first).days >= MAX_SEARCH_DAYS:
            raise ToolError(f"Search between 1 and {MAX_SEARCH_DAYS} days at a time.")
        window_start = max(datetime.combine(first, time(), zone), datetime.now(zone))
        window_end = datetime.combine(last + timedelta(days=1), time(), zone)
        if window_end <= window_start:
            raise ToolError("Those dates have already passed. Search from today onward.")
        slots = await execute_tool(
            lambda: provider.availability(window_start, window_end),
            context=context,
            timeout=settings.tool_timeout_seconds,
            retry_safe=True,
            retries=settings.tool_retries,
            filler_delay=settings.tool_filler_delay_seconds,
        )
        starts = sorted(slot.start for slot in slots)
        return {
            "timezone": timezone,
            "slots": [local(start) for start in starts[:MAX_SLOTS]],
            "more_available": len(starts) > MAX_SLOTS,
        }

    async def book_appointment(
        context: RunContext,
        start: Annotated[
            str, Field(description="Appointment start time exactly as check_availability returned")
        ],
        name: Annotated[str, Field(min_length=1, max_length=200, description="The caller's name")],
        phone: Annotated[
            str, Field(min_length=1, max_length=100, description="The caller's phone number")
        ],
        notes: Annotated[
            str | None, Field(max_length=2000, description="The reason for the appointment")
        ] = None,
    ) -> dict[str, str]:
        try:
            when = datetime.fromisoformat(start)
        except ValueError as exc:
            raise ToolError(
                "Provide the start time exactly as check_availability returned."
            ) from exc
        if when.tzinfo is None:
            when = when.replace(tzinfo=zone)
        if when <= datetime.now(zone):
            raise ToolError("That time has already passed. Offer the caller a later time.")
        attendee = Attendee(
            name=name.strip(LEAD_WHITESPACE),
            phone=phone.strip(LEAD_WHITESPACE),
            notes=(notes or "").strip(LEAD_WHITESPACE) or None,
        )
        if not attendee.name or not attendee.phone:
            raise ToolError("Provide the caller's name and phone number.")

        async def create() -> Booking:
            try:
                return await provider.create(when, attendee)
            except SlotUnavailableError as exc:
                raise ToolError(
                    "That time is no longer available. Offer the caller another time "
                    "from check_availability."
                ) from exc

        booking = await execute_tool(
            create,
            context=context,
            timeout=settings.tool_timeout_seconds,
            filler_delay=settings.tool_filler_delay_seconds,
        )
        booked.add(booking.id)
        return {
            "booking_id": booking.id,
            "start": local(booking.start),
            "end": local(booking.end),
            "status": "confirmed",
        }

    async def cancel_appointment(
        context: RunContext,
        booking_id: Annotated[
            str, Field(description="The booking_id that book_appointment returned")
        ],
    ) -> dict[str, str]:
        if booking_id not in booked:
            raise ToolError("Only appointments booked during this call can be cancelled.")
        await execute_tool(
            lambda: provider.cancel(booking_id),
            context=context,
            timeout=settings.tool_timeout_seconds,
            retry_safe=True,
            retries=settings.tool_retries,
            filler_delay=settings.tool_filler_delay_seconds,
        )
        booked.discard(booking_id)
        return {"booking_id": booking_id, "status": "cancelled"}

    return [
        llm.function_tool(
            check_availability,
            description=(
                f"List open appointment start times in the business timezone ({timezone}) "
                f"for up to {MAX_SEARCH_DAYS} days. Offer the caller only times this returns."
            ),
        ),
        llm.function_tool(
            book_appointment,
            description=(
                "Book an appointment at a start time from check_availability, using only the "
                "name, phone number, and reason the caller provided. Success means the "
                "appointment is confirmed."
            ),
        ),
        llm.function_tool(
            cancel_appointment,
            description=(
                "Cancel an appointment booked earlier in this call, using the booking_id "
                "that book_appointment returned."
            ),
        ),
    ]
