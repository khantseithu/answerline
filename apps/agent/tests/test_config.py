from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from answerline_agent.capture_lead import LeadCaptureContext
from answerline_agent.config import (
    DEFAULT_RECORDING_NOTICE,
    BookAppointmentTool,
    load_agent_config,
)
from answerline_agent.settings import Settings
from answerline_agent.tools import build_configured_tools

ROOT = Path(__file__).resolve().parents[3]


def test_example_agent_config_loads():
    config = load_agent_config(ROOT / "agents/bright-smile-dental.yaml")
    assert config.name == "Bright Smile Dental"
    assert config.models.llm.fallback
    assert config.hours and config.hours.after_hours == "voicemail"


def test_recording_is_off_by_default_with_standard_notice():
    config = load_agent_config(ROOT / "agents/bright-smile-dental.yaml")
    assert config.recording.enabled is False
    assert config.recording.notice == DEFAULT_RECORDING_NOTICE


def test_book_appointment_defaults_to_native_provider():
    tool = BookAppointmentTool(builtin="book_appointment")
    assert (tool.provider, tool.slot_minutes) == ("answerline", 30)


@pytest.mark.parametrize("path", sorted((ROOT / "agents").glob("*.yaml")), ids=lambda p: p.stem)
def test_business_templates_load_with_runtime_tools_and_matching_evals(path):
    config = load_agent_config(path)
    context = LeadCaptureContext(
        publisher=SimpleNamespace(), tenant="default", agent=path.stem, room_name="template-test"
    )
    tools = build_configured_tools(
        config, Settings(_env_file=None), lead_context=context, booking=object()
    )
    tool_names = {tool.id for tool in tools}
    assert {"business_hours", "capture_lead", "take_voicemail"} <= tool_names
    assert all(hasattr(spec, "builtin") for spec in config.tools)
    if any(isinstance(spec, BookAppointmentTool) for spec in config.tools):
        assert {"check_availability", "book_appointment", "confirm_booking"} <= tool_names
    suite = yaml.safe_load((ROOT / "evals" / path.name).read_text())
    for scenario in suite:
        expected_tool = scenario["expect"].get("tool_called")
        if expected_tool:
            assert expected_tool in tool_names
