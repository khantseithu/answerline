import logging

from livekit.agents import TurnHandlingOptions, inference

from .languages import turn_detector_supports
from .settings import Settings

logger = logging.getLogger("answerline.agent")

INTERRUPTION_MIN_DURATION = 0.6
INTERRUPTION_MIN_WORDS = 1
FALSE_INTERRUPTION_TIMEOUT = 1.5


def build_turn_detection(mode: str) -> inference.TurnDetector | str:
    match mode:
        case "local":
            return inference.TurnDetector(version="v1-mini")
        case "cloud":
            return inference.TurnDetector(version="v1")
        case "stt" | "vad":
            return mode
    raise ValueError(f"Unsupported turn detection mode: {mode}")


def turn_detection_mode(mode: str, language: str) -> str:
    if mode in ("local", "cloud") and not turn_detector_supports(language):
        logger.info("turn detector does not support %s; using STT endpointing", language)
        return "stt"
    return mode


def build_turn_handling(settings: Settings, language: str = "en") -> TurnHandlingOptions:
    return TurnHandlingOptions(
        turn_detection=build_turn_detection(turn_detection_mode(settings.turn_detection, language)),
        interruption={
            "mode": settings.interruption_mode,
            "min_duration": INTERRUPTION_MIN_DURATION,
            "min_words": INTERRUPTION_MIN_WORDS,
            "resume_false_interruption": True,
            "false_interruption_timeout": FALSE_INTERRUPTION_TIMEOUT,
        },
        preemptive_generation={"enabled": True},
    )
