from answerline_agent.config import AgentConfig
from answerline_agent.languages import (
    call_language,
    greeting_for,
    language_instructions,
    match_language,
)


def config(**overrides) -> AgentConfig:
    return AgentConfig.model_validate(
        {
            "name": "Bright Smile Dental",
            "greeting": "Thanks for calling.",
            "instructions": "You are the receptionist.",
            "models": {
                "stt": "deepgram/nova-3",
                "llm": {"primary": "anthropic/claude-sonnet-4-6"},
                "tts": "cartesia/sonic-3",
            },
            **overrides,
        }
    )


MULTI = config(
    languages={
        "es": {"greeting": "Gracias por llamar.", "instructions": "Usa usted."},
        "fr": {},
    }
)


def test_dispatch_language_matches_configured_languages():
    assert call_language(MULTI, "es") == "es"
    assert call_language(MULTI, "es-MX") == "es"
    assert call_language(MULTI, "FR") == "fr"
    assert call_language(MULTI, "de") == "en"
    assert call_language(MULTI, None) == "en"
    assert match_language(config(language="es-MX"), "es-mx") == "es-MX"


def test_greeting_follows_the_call_language():
    assert greeting_for(MULTI, "es") == "Gracias por llamar."
    assert greeting_for(MULTI, "fr") == "Thanks for calling."
    assert greeting_for(MULTI, "en") == "Thanks for calling."


def test_english_only_agents_get_no_language_section():
    assert language_instructions(config(), "en") is None
    assert language_instructions(config(language="en-US"), "en-US") is None


def test_single_language_agents_are_told_their_language():
    assert language_instructions(config(language="es"), "es") == (
        "# Language\n\nSpeak Spanish with the caller."
    )


def test_multilingual_agents_list_languages_and_per_language_instructions():
    section = language_instructions(MULTI, "es")
    assert section is not None
    assert "Start the call in Spanish" in section
    assert "English, Spanish, French" in section
    assert "## When speaking Spanish\n\nUsa usted." in section
    assert "When speaking French" not in section
