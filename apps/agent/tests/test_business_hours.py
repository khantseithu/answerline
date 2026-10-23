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
    assert "Holiday overrides are not supported" in schema["description"]


@pytest.mark.parametrize("window", ["24:00-18:00", "09:99-18:00", "09:00-09:00"])
def test_invalid_clock_values_fail_when_building_tool(window):
    with pytest.raises(ValueError):
        build_business_hours_tool(Hours(timezone="UTC", weekdays=window))


def test_invalid_timezone_fails_when_building_tool():
    with pytest.raises(ZoneInfoNotFoundError):
        build_business_hours_tool(Hours(timezone="Invalid/Timezone", weekdays="09:00-18:00"))
