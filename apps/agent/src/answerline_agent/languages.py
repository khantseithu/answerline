import logging
from typing import Protocol

from livekit.agents import UserInputTranscribedEvent
from livekit.agents.inference.eot.languages import LOCAL_LANGUAGES
from livekit.agents.language import LanguageCode

from .config import AgentConfig

logger = logging.getLogger("answerline.agent")

MIN_SWITCH_WORDS = 2


def base_language(code: str) -> str:
    return LanguageCode(code).language


def turn_detector_supports(code: str) -> bool:
    return base_language(code) in LOCAL_LANGUAGES


def language_name(code: str) -> str:
    name = LanguageCode(code).to_language_name()
    return name.title() if name else code


def agent_languages(config: AgentConfig) -> list[str]:
    return [config.language, *(code for code in config.languages if code != config.language)]


def match_language(config: AgentConfig, code: str | None) -> str | None:
    if not code:
        return None
    languages = agent_languages(config)
    exact = next((lang for lang in languages if lang.lower() == code.lower()), None)
    if exact:
        return exact
    base = base_language(code)
    return next((lang for lang in languages if base_language(lang) == base), None)


def call_language(config: AgentConfig, requested: str | None) -> str:
    return match_language(config, requested) or config.language


def stt_language(config: AgentConfig, language: str) -> str:
    return "multi" if len(agent_languages(config)) > 1 else language


def greeting_for(config: AgentConfig, language: str) -> str:
    override = config.languages.get(language)
    return override.greeting if override and override.greeting else config.greeting


def language_instructions(config: AgentConfig, language: str) -> str | None:
    languages = agent_languages(config)
    if len(languages) == 1 and base_language(language) == "en":
        return None
    lines = ["# Language", ""]
    if len(languages) == 1:
        lines.append(f"Speak {language_name(language)} with the caller.")
    else:
        names = ", ".join(language_name(lang) for lang in languages)
        lines.append(
            f"Start the call in {language_name(language)}. The caller may speak any of: "
            f"{names}. Always reply in the language the caller is using, and switch when "
            "they switch. The sections below apply only while the caller speaks that "
            "language; never reply in a language just because a section is written in it."
        )
    for lang in languages:
        override = config.languages.get(lang)
        if override and override.instructions:
            heading = f"## Only when the caller speaks {language_name(lang)}"
            lines += ["", heading, "", override.instructions.strip()]
    return "\n".join(lines)


class LanguageTTS(Protocol):
    def update_options(self, *, language: str) -> None: ...


class CallerLanguage:
    def __init__(self, config: AgentConfig, language: str, tts: LanguageTTS) -> None:
        self._config = config
        self._tts = tts
        self.current = language

    def on_transcribed(self, event: UserInputTranscribedEvent) -> None:
        if not event.is_final or not event.language:
            return
        if len(event.transcript.split()) < MIN_SWITCH_WORDS:
            return
        language = match_language(self._config, event.language)
        if language is None or language == self.current:
            return
        logger.info("caller switched language from %s to %s", self.current, language)
        self.current = language
        self._tts.update_options(language=base_language(language))
