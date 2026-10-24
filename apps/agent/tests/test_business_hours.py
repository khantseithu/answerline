import asyncio
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfoNotFoundError

import pytest
from answerline_agent import business_hours
from answerline_agent.business_hours import build_business_hours_tool
from answerline_agent.config import Hours
from livekit.agents import llm


@pytest.mark.parametrize(
    ("instant", "weekdays", "weekends", "expected"),
    [
        ("2026-10-23T12:59:00+00:00", "09:00-18:00", None, False),
        ("2026-10-23T13:00:00+00:00", "09:00-18:00", None, True),
        ("2026-10-23T21:59:00+00:00", "09:00-18:00", None, True),
        ("2026-10-23T22:00:00+00:00", "09:00-18:00", None, False),
        ("2026-10-24T16:00:00+00:00", "09:00-18:00", None, False),
        ("2026-10-24T14:00:00+00:00", "09:00-18:00", "10:00-14:00", True),
        ("2026-10-25T18:00:00+00:00", "09:00-18:00", "10:00-14:00", False),
        ("2026-10-24T02:00:00+00:00", "22:00-02:00", None, True),
        ("2026-10-24T05:59:00+00:00", "22:00-02:00", None, True),
        ("2026-10-24T06:00:00+00:00", "22:00-02:00", None, False),
        ("2026-10-25T05:00:00+00:00", "22:00-02:00", None, False),
        ("2026-10-26T05:00:00+00:00", "09:00-18:00", "22:00-02:00", True),
        ("2026-10-23T01:00:00+00:00", "09:00-18:00", None, False),
        ("2026-11-01T05:30:00+00:00", "09:00-18:00", "01:00-02:00", True),
        ("2026-11-01T06:30:00+00:00", "09:00-18:00", "01:00-02:00", True),
        ("2026-11-01T07:00:00+00:00", "09:00-18:00", "01:00-02:00", False),
        ("2026-03-08T07:00:00+00:00", "09:00-18:00", "01:00-04:00", True),
    ],
)
def test_business_hours_uses_local_schedule(monkeypatch, instant, weekdays, weekends, expected):
    now = datetime.fromisoformat(instant)
    monkeypatch.setattr(
        business_hours, "datetime", SimpleNamespace(now=lambda zone: now.astimezone(zone))
    )
    hours = Hours(
        timezone="America/New_York", weekdays=weekdays, weekends=weekends, after_hours="answer"
    )
    result = asyncio.run(build_business_hours_tool(hours)(context=None))
    assert result == {
        "is_open": expected,
        "local_time": now.astimezone(business_hours.ZoneInfo(hours.timezone)).isoformat(),
        "timezone": hours.timezone,
        "weekdays": weekdays,
        "weekends": weekends,
        "after_hours": "answer",
    }


def test_tool_has_no_caller_supplied_clock_or_schedule():
    tool = build_business_hours_tool(Hours(timezone="UTC", weekdays="09:00-18:00"))
    schema = llm.utils.build_legacy_openai_schema(tool)["function"]
    assert schema["name"] == "business_hours"
    assert schema["parameters"]["properties"] == {}
    assert "does not transfer" in schema["description"]
    assert "holiday" in schema["description"]


def lookup_at(monkeypatch, hours: Hours, instant: str) -> dict[str, object]:
    now = datetime.fromisoformat(instant)
    monkeypatch.setattr(
        business_hours, "datetime", SimpleNamespace(now=lambda zone: now.astimezone(zone))
    )
    return asyncio.run(build_business_hours_tool(hours)(context=None))


HOLIDAY_HOURS = Hours(
    timezone="America/New_York",
    weekdays="09:00-18:00",
    holidays=[
        {"date": "2026-12-25", "name": "Christmas Day"},
        {"date": "2026-12-24", "hours": "09:00-13:00"},
    ],
)


def test_closed_holiday_reports_closed_with_its_name(monkeypatch):
    result = lookup_at(monkeypatch, HOLIDAY_HOURS, "2026-12-25T15:00:00+00:00")
    assert result["is_open"] is False
    assert result["holiday"] == {"date": "2026-12-25", "name": "Christmas Day"}


@pytest.mark.parametrize(
    ("instant", "expected"),
    [("2026-12-24T17:59:00+00:00", True), ("2026-12-24T18:00:00+00:00", False)],
)
def test_holiday_special_hours_replace_the_regular_window(monkeypatch, instant, expected):
    result = lookup_at(monkeypatch, HOLIDAY_HOURS, instant)
    assert result["is_open"] is expected
    assert result["holiday"] == {"date": "2026-12-24", "hours": "09:00-13:00"}


def test_regular_days_have_no_holiday_field(monkeypatch):
    assert "holiday" not in lookup_at(monkeypatch, HOLIDAY_HOURS, "2026-12-23T15:00:00+00:00")


def test_overnight_shift_carries_into_a_closed_holiday():
    hours = Hours(timezone="UTC", weekdays="22:00-02:00", holidays=[{"date": "2026-12-25"}])
    schedule = business_hours.Schedule.from_hours(hours)
    assert schedule.is_open_at(datetime.fromisoformat("2026-12-25T01:00:00+00:00"))
    assert not schedule.is_open_at(datetime.fromisoformat("2026-12-25T23:00:00+00:00"))


def test_invalid_holiday_hours_fail_when_building_tool():
    hours = Hours(
        timezone="UTC",
        weekdays="09:00-18:00",
        holidays=[{"date": "2026-12-24", "hours": "25:00-13:00"}],
    )
    with pytest.raises(ValueError):
        build_business_hours_tool(hours)


@pytest.mark.parametrize("window", ["24:00-18:00", "09:99-18:00", "09:00-09:00"])
def test_invalid_clock_values_fail_when_building_tool(window):
    with pytest.raises(ValueError):
        build_business_hours_tool(Hours(timezone="UTC", weekdays=window))


def test_invalid_timezone_fails_when_building_tool():
    with pytest.raises(ZoneInfoNotFoundError):
        build_business_hours_tool(Hours(timezone="Invalid/Timezone", weekdays="09:00-18:00"))
