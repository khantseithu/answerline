from pathlib import Path

from answerline_agent.config import load_agent_config

ROOT = Path(__file__).resolve().parents[3]


def test_example_agent_config_loads():
    config = load_agent_config(ROOT / "agents/bright-smile-dental.yaml")
    assert config.name == "Bright Smile Dental"
    assert config.models.llm.fallback
    assert config.hours and config.hours.after_hours == "voicemail"
