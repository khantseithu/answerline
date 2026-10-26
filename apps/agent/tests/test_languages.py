from answerline_agent.config import AgentConfig
from answerline_agent.languages import (
    CallerLanguage,
    call_language,
    greeting_for,
    language_instructions,
    match_language,
    stt_language,
)
from livekit.agents import UserInputTranscribedEvent


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
    assert "never reply in a language just because a section is written in it" in section
    assert "## Only when the caller speaks Spanish\n\nUsa usted." in section
    assert "caller speaks French" not in section


class RecordingTTS:
    def __init__(self) -> None:
        self.languages: list[str] = []

    def update_options(self, *, language: str) -> None:
        self.languages.append(language)


def transcribed(text: str, language: str | None, *, final: bool = True):
    return UserInputTranscribedEvent(transcript=text, is_final=final, language=language)


def test_multilingual_agents_detect_language_in_stt():
    assert stt_language(MULTI, "en") == "multi"
    assert stt_language(config(language="es"), "es") == "es"


def test_tts_follows_the_caller_into_a_configured_language():
    tts = RecordingTTS()
    caller = CallerLanguage(MULTI, "en", tts)
    caller.on_transcribed(transcribed("Hola, quiero una cita", "es-419"))
    caller.on_transcribed(transcribed("para el martes", "es"))
    caller.on_transcribed(transcribed("Bonjour, je voudrais", "fr"))
    assert tts.languages == ["es", "fr"]
    assert caller.current == "fr"


def test_switching_ignores_interim_short_and_unconfigured_speech():
    tts = RecordingTTS()
    caller = CallerLanguage(MULTI, "en", tts)
    caller.on_transcribed(transcribed("Hola, quiero una cita", "es", final=False))
    caller.on_transcribed(transcribed("Sí", "es"))
    caller.on_transcribed(transcribed("Guten Tag, ich möchte", "de"))
    caller.on_transcribed(transcribed("no language reported", None))
    assert tts.languages == []
    assert caller.current == "en"
