from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from livekit.agents import RunContext, llm

from .config import Holiday, Hours
from .settings import Settings
from .tool_policy import execute_tool

Window = tuple[time, time]


def parse_window(value: str) -> Window:
    start, end = (time.fromisoformat(part) for part in value.split("-"))
    if start == end:
        raise ValueError("Business hours must have different opening and closing times")
    return start, end


@dataclass(frozen=True)
class Schedule:
    zone: ZoneInfo
    weekdays: Window
    weekends: Window | None
    holidays: dict[date, tuple[Holiday, Window | None]]

    @classmethod
    def from_hours(cls, hours: Hours) -> "Schedule":
        return cls(
            zone=ZoneInfo(hours.timezone),
            weekdays=parse_window(hours.weekdays),
            weekends=parse_window(hours.weekends) if hours.weekends else None,
            holidays={
                holiday.date: (holiday, parse_window(holiday.hours) if holiday.hours else None)
                for holiday in hours.holidays
            },
        )

    def now(self) -> datetime:
        return datetime.now(self.zone)

    def holiday(self, day: date) -> Holiday | None:
        entry = self.holidays.get(day)
        return entry[0] if entry else None

    def window(self, day: date) -> Window | None:
        if day in self.holidays:
            return self.holidays[day][1]
        return self.weekdays if day.weekday() < 5 else self.weekends

    def is_open_at(self, local: datetime) -> bool:
        clock = local.time()
        for days_ago in (0, 1):
            window = self.window(local.date() - timedelta(days=days_ago))
            if window is None:
                continue
            start, end = window
            if days_ago == 0:
                if start < end and start <= clock < end:
                    return True
                if start > end and clock >= start:
                    return True
            elif start > end and clock < end:
                return True
        return False

    def is_open(self) -> bool:
        return self.is_open_at(self.now())


def build_business_hours_tool(hours: Hours, settings: Settings | None = None) -> llm.FunctionTool:
    settings = settings or Settings()
    schedule = Schedule.from_hours(hours)

    async def lookup() -> dict[str, object]:
        local = schedule.now()
        result: dict[str, object] = {
            "is_open": schedule.is_open_at(local),
            "local_time": local.isoformat(),
            "timezone": hours.timezone,
            "weekdays": hours.weekdays,
            "weekends": hours.weekends,
            "after_hours": hours.after_hours,
        }
        holiday = schedule.holiday(local.date())
        if holiday:
            result["holiday"] = holiday.model_dump(mode="json", exclude_none=True)
        return result

    async def business_hours(context: RunContext) -> dict[str, object]:
        return await execute_tool(
            lookup,
            context=context,
            timeout=settings.tool_timeout_seconds,
            retry_safe=True,
            retries=settings.tool_retries,
            filler_delay=settings.tool_filler_delay_seconds,
        )

    return llm.function_tool(
        business_hours,
        description=(
            "Check whether the business is open right now and get its regular opening hours "
            "in the business timezone. When today is a holiday, the holiday field gives its "
            "name and special hours; no hours means closed all day. The after_hours field "
            "reports the configured policy only; this tool does not transfer the call or "
            "record voicemail."
        ),
    )
