from livekit.agents.inference.eot.languages import LOCAL_LANGUAGES
from livekit.agents.language import LanguageCode


def base_language(code: str) -> str:
    return LanguageCode(code).language


def turn_detector_supports(code: str) -> bool:
    return base_language(code) in LOCAL_LANGUAGES
