from livekit.agents.inference.eot.languages import LOCAL_LANGUAGES
from livekit.agents.language import LanguageCode

from .config import AgentConfig


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


def greeting_for(config: AgentConfig, language: str) -> str:
    override = config.languages.get(language)
    return override.greeting if override and override.greeting else config.greeting


def localizes_messages(config: AgentConfig) -> bool:
    return len(agent_languages(config)) > 1 or base_language(config.language) != "en"


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
            "they switch."
        )
    for lang in languages:
        override = config.languages.get(lang)
        if override and override.instructions:
            heading = f"## When speaking {language_name(lang)}"
            lines += ["", heading, "", override.instructions.strip()]
    return "\n".join(lines)
