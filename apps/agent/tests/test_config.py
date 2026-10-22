from pathlib import Path

from answerline_agent.config import DEFAULT_RECORDING_NOTICE, load_agent_config

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
