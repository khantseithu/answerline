from livekit.agents import TurnHandlingOptions, inference

from .settings import Settings

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


def build_turn_handling(settings: Settings) -> TurnHandlingOptions:
    return TurnHandlingOptions(
        turn_detection=build_turn_detection(settings.turn_detection),
        interruption={
            "mode": settings.interruption_mode,
            "min_duration": INTERRUPTION_MIN_DURATION,
            "min_words": INTERRUPTION_MIN_WORDS,
            "resume_false_interruption": True,
            "false_interruption_timeout": FALSE_INTERRUPTION_TIMEOUT,
        },
        preemptive_generation={"enabled": True},
    )
