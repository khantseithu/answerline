from answerline_agent.config import load_agent_config
from answerline_agent.prompts import VOICE_RULES, compose_instructions
from answerline_agent.settings import DEFAULT_AGENTS_DIR


def test_voice_rules_come_first_and_agent_instructions_follow():
    composed = compose_instructions("You are the receptionist for Acme.\n\n")
    assert composed.startswith(VOICE_RULES)
    assert composed.endswith("You are the receptionist for Acme.\n")
    assert composed.index("Voice output rules") < composed.index("Acme")


def test_voice_rules_cover_spoken_output():
    text = VOICE_RULES.lower()
    for fragment in (
        "plain text",
        "one question at a time",
        "phone numbers",
        "https://",
        "tool names",
    ):
        assert fragment in text


def test_example_agent_prompt_keeps_its_own_instructions():
    config = load_agent_config(DEFAULT_AGENTS_DIR / "bright-smile-dental.yaml")
    composed = compose_instructions(config.instructions)
    assert config.instructions.strip() in composed
