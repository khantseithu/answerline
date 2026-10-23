from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from livekit.agents import RunContext, llm

from .config import Hours
from .settings import Settings
from .tool_policy import execute_tool


def parse_window(value: str) -> tuple[time, time]:
    start, end = (time.fromisoformat(part) for part in value.split("-"))
    if start == end:
        raise ValueError("Business hours must have different opening and closing times")
    return start, end


def is_open_at(
    local: datetime,
    weekdays: tuple[time, time],
    weekends: tuple[time, time] | None,
) -> bool:
    clock = local.time()
    for days_ago in (0, 1):
        day = local.date() - timedelta(days=days_ago)
        window = weekdays if day.weekday() < 5 else weekends
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


def build_business_hours_tool(hours: Hours, settings: Settings | None = None) -> llm.FunctionTool:
    settings = settings or Settings()
    zone = ZoneInfo(hours.timezone)
    weekdays = parse_window(hours.weekdays)
    weekends = parse_window(hours.weekends) if hours.weekends else None

    async def lookup() -> dict[str, object]:
        local = datetime.now(zone)
        return {
            "is_open": is_open_at(local, weekdays, weekends),
            "local_time": local.isoformat(),
            "timezone": hours.timezone,
            "weekdays": hours.weekdays,
            "weekends": hours.weekends,
            "after_hours": hours.after_hours,
        }

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
            "in the business timezone. Holiday overrides are not supported. The after_hours "
            "field reports the configured policy only; this tool does not transfer the call "
            "or record voicemail."
        ),
    )
