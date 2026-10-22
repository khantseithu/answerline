import numpy as np
import pytest
from answerline_agent import turns
from answerline_agent.settings import Settings
from answerline_agent.turns import build_turn_detection, build_turn_handling
from livekit.agents import inference
from pydantic import ValidationError


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_defaults_are_self_hosted(monkeypatch):
    monkeypatch.delenv("TURN_DETECTION", raising=False)
    monkeypatch.delenv("INTERRUPTION_MODE", raising=False)
    monkeypatch.setenv("LIVEKIT_DEV_MODE", "1")
    settings = Settings(_env_file=None)
    options = build_turn_handling(settings)
    detector = options["turn_detection"]
    assert isinstance(detector, inference.TurnDetector)
    assert detector.model == "turn-detector-v1-mini"
    assert options["interruption"]["mode"] == "vad"


def test_local_detector_is_independent_of_dev_mode_and_cloud_credentials(monkeypatch):
    monkeypatch.setenv("LIVEKIT_DEV_MODE", "1")
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")
    detector = build_turn_detection("local")
    assert detector.model == "turn-detector-v1-mini"
    assert detector.provider == "livekit"


def test_local_detector_predicts_without_network():
    from livekit.local_inference import EOT

    probability = EOT().predict(np.zeros(16000, dtype=np.int16))
    assert 0.0 <= probability <= 1.0


def test_cloud_detector_is_opt_in(monkeypatch):
    monkeypatch.setenv("LIVEKIT_API_KEY", "key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")
    detector = build_turn_detection("cloud")
    assert isinstance(detector, inference.TurnDetector)
    assert detector.model == "turn-detector-v1"


@pytest.mark.parametrize("mode", ["stt", "vad"])
def test_passthrough_modes(mode):
    options = build_turn_handling(_settings(turn_detection=mode))
    assert options["turn_detection"] == mode


def test_adaptive_interruption_is_opt_in():
    options = build_turn_handling(_settings(interruption_mode="adaptive"))
    assert options["interruption"]["mode"] == "adaptive"


def test_interruption_tuning():
    interruption = build_turn_handling(_settings())["interruption"]
    assert interruption["min_duration"] == turns.INTERRUPTION_MIN_DURATION
    assert interruption["min_words"] == turns.INTERRUPTION_MIN_WORDS
    assert interruption["resume_false_interruption"] is True
    assert interruption["false_interruption_timeout"] == turns.FALSE_INTERRUPTION_TIMEOUT


def test_preemptive_generation_enabled():
    assert build_turn_handling(_settings())["preemptive_generation"] == {"enabled": True}


def test_unknown_modes_are_rejected():
    with pytest.raises(ValidationError):
        _settings(turn_detection="magic")
    with pytest.raises(ValidationError):
        _settings(interruption_mode="magic")
    with pytest.raises(ValueError):
        build_turn_detection("magic")


def test_settings_read_turn_environment(monkeypatch):
    monkeypatch.setenv("TURN_DETECTION", "stt")
    monkeypatch.setenv("INTERRUPTION_MODE", "adaptive")
    settings = Settings(_env_file=None)
    assert settings.turn_detection == "stt"
    assert settings.interruption_mode == "adaptive"
