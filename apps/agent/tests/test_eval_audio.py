import numpy as np
import pytest
from answerline_agent.eval_audio import (
    PHONE_SAMPLE_RATE,
    add_noise,
    band_pass,
    degrade_caller_audio,
    mulaw_decode,
    mulaw_encode,
    resample,
)
from livekit import rtc

SOURCE_RATE = 24000


def _tone(
    freq: float, seconds: float = 1.0, rate: int = PHONE_SAMPLE_RATE, amplitude: float = 8000
):
    t = np.arange(round(rate * seconds)) / rate
    return amplitude * np.sin(2 * np.pi * freq * t)


def _rms(samples: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(samples.astype(np.float64)))))


def _db(ratio: float) -> float:
    return 20 * np.log10(ratio)


def _frame(samples: np.ndarray, rate: int = SOURCE_RATE, channels: int = 1) -> rtc.AudioFrame:
    pcm = np.clip(np.rint(samples), -32768, 32767).astype(np.int16)
    return rtc.AudioFrame(
        data=pcm.tobytes(),
        sample_rate=rate,
        num_channels=channels,
        samples_per_channel=pcm.size // channels,
    )


def _pcm(frames: list[rtc.AudioFrame]) -> np.ndarray:
    return np.concatenate([np.frombuffer(frame.data, dtype=np.int16) for frame in frames])


def test_band_pass_keeps_in_band_tones():
    for freq in (500, 1000, 2000, 3000):
        tone = _tone(freq)
        gain = _db(_rms(band_pass(tone, PHONE_SAMPLE_RATE)) / _rms(tone))
        assert abs(gain) < 2.5


def test_band_pass_attenuates_tones_below_the_band():
    tone = _tone(60)
    assert _db(_rms(band_pass(tone, PHONE_SAMPLE_RATE)) / _rms(tone)) < -30
    tone = _tone(150)
    assert _db(_rms(band_pass(tone, PHONE_SAMPLE_RATE)) / _rms(tone)) < -10


def test_band_pass_attenuates_tones_above_the_band():
    tone = _tone(3950)
    assert _db(_rms(band_pass(tone, PHONE_SAMPLE_RATE)) / _rms(tone)) < -3


def test_band_pass_removes_dc():
    assert _rms(band_pass(np.full(8000, 5000.0), PHONE_SAMPLE_RATE)) < 1


def test_resample_preserves_a_tone_and_length():
    tone = _tone(1000, rate=SOURCE_RATE)
    narrow = resample(tone, SOURCE_RATE, PHONE_SAMPLE_RATE)
    assert narrow.size == PHONE_SAMPLE_RATE
    assert _rms(narrow) == pytest.approx(_rms(tone), rel=0.01)


def test_phone_profile_drops_energy_above_nyquist():
    frames = degrade_caller_audio([_frame(_tone(6000, rate=SOURCE_RATE))], profile="phone")
    assert _rms(_pcm(frames)) < 0.01 * 8000


def test_phone_profile_attenuates_low_rumble_but_keeps_speech_band():
    inside = degrade_caller_audio([_frame(_tone(1000, rate=SOURCE_RATE))], profile="phone")
    below = degrade_caller_audio([_frame(_tone(80, rate=SOURCE_RATE))], profile="phone")
    reference = _rms(_tone(1000, rate=SOURCE_RATE))
    assert _db(_rms(_pcm(inside)) / reference) > -2
    assert _db(_rms(_pcm(below)) / reference) < -30


def test_phone_profile_outputs_mono_8khz_frames():
    stereo = np.stack([_tone(1000, rate=SOURCE_RATE), _tone(1000, rate=SOURCE_RATE)], axis=1)
    frames = degrade_caller_audio([_frame(stereo.reshape(-1), channels=2)], profile="phone")
    assert all(frame.sample_rate == PHONE_SAMPLE_RATE for frame in frames)
    assert all(frame.num_channels == 1 for frame in frames)
    assert sum(frame.samples_per_channel for frame in frames) == PHONE_SAMPLE_RATE


def test_mulaw_known_values():
    assert mulaw_encode(np.array([0, 0, 1000, -1000], dtype=np.int16)).tolist() == [
        0xFF,
        0xFF,
        0xCE,
        0x4E,
    ]
    assert mulaw_decode(np.array([0xFF, 0x7F], dtype=np.uint8)).tolist() == [0, 0]
    assert mulaw_decode(np.array([0x80, 0x00], dtype=np.uint8)).tolist() == [32124, -32124]


def test_mulaw_decode_encode_is_the_identity_on_every_code():
    codes = np.array([code for code in range(256) if code != 0x7F], dtype=np.uint8)
    assert np.array_equal(mulaw_encode(mulaw_decode(codes)), codes)


def test_mulaw_round_trip_error_is_bounded():
    pcm = np.arange(-32768, 32768, dtype=np.int16)
    decoded = mulaw_decode(mulaw_encode(pcm)).astype(np.int32)
    error = np.abs(decoded - pcm.astype(np.int32))
    magnitude = np.abs(pcm.astype(np.int32))
    assert error.max() <= 1024
    unclipped = magnitude <= 32635
    assert np.all(error[unclipped] <= np.maximum(magnitude[unclipped] * 0.045, 8))


def test_mulaw_round_trip_keeps_speech_level_signal_to_noise_high():
    tone = np.rint(_tone(1000, amplitude=6000)).astype(np.int16)
    decoded = mulaw_decode(mulaw_encode(tone)).astype(np.float64)
    assert _db(_rms(tone) / _rms(decoded - tone)) > 30


@pytest.mark.parametrize("snr_db", [0, 10, 20, 40, 60])
def test_noise_matches_the_requested_snr(snr_db):
    signal = _tone(800, seconds=2.0, amplitude=6000)
    noisy = add_noise(signal, snr_db, seed=3)
    measured = _db(_rms(signal) / _rms(noisy - signal))
    assert measured == pytest.approx(snr_db, abs=0.5)


def test_noise_snr_is_measured_against_the_reference_signal():
    signal = np.concatenate([_tone(800, seconds=1.0, amplitude=6000), np.zeros(PHONE_SAMPLE_RATE)])
    noisy = add_noise(signal, 20, seed=3, reference=signal[:PHONE_SAMPLE_RATE])
    measured = _db(_rms(signal[:PHONE_SAMPLE_RATE]) / _rms(noisy - signal))
    assert measured == pytest.approx(20, abs=0.5)
    assert _rms(noisy[PHONE_SAMPLE_RATE:]) > 0


def test_noise_leaves_silence_untouched():
    silence = np.zeros(100)
    assert np.array_equal(add_noise(silence, 10, seed=1), silence)


def test_noise_differs_by_seed():
    signal = _tone(800)
    assert not np.array_equal(add_noise(signal, 20, seed=1), add_noise(signal, 20, seed=2))


def test_degrade_is_deterministic_for_the_same_seed_and_input():
    frames = [_frame(_tone(700, rate=SOURCE_RATE)), _frame(np.zeros(SOURCE_RATE // 2))]
    first = degrade_caller_audio(frames, profile="phone", noise_snr_db=15, seed=9, padding_frames=1)
    second = degrade_caller_audio(
        frames, profile="phone", noise_snr_db=15, seed=9, padding_frames=1
    )
    other = degrade_caller_audio(
        frames, profile="phone", noise_snr_db=15, seed=10, padding_frames=1
    )
    assert _pcm(first).tobytes() == _pcm(second).tobytes()
    assert _pcm(first).tobytes() != _pcm(other).tobytes()


def test_degrade_noise_excludes_trailing_padding_from_the_reference_level():
    speech = _tone(700, seconds=1.0, rate=SOURCE_RATE, amplitude=6000)
    padding = np.zeros(SOURCE_RATE)
    frames = [_frame(speech), _frame(padding)]
    clean = _pcm(degrade_caller_audio(frames, profile="phone"))
    noisy = _pcm(
        degrade_caller_audio(frames, profile="phone", noise_snr_db=20, seed=1, padding_frames=1)
    )
    speech_size = PHONE_SAMPLE_RATE
    noise = noisy.astype(np.float64) - clean.astype(np.float64)
    measured = _db(_rms(clean[:speech_size]) / _rms(noise[:speech_size]))
    assert measured == pytest.approx(20, abs=0.5)
    assert _rms(noise[speech_size:]) > 0


def test_clean_profile_without_noise_returns_the_frames_unchanged():
    frames = [_frame(_tone(700, rate=SOURCE_RATE))]
    assert degrade_caller_audio(frames) is frames
    assert degrade_caller_audio(frames, profile="clean") is frames


def test_clean_profile_with_noise_keeps_the_source_format():
    frames = [_frame(_tone(700, rate=SOURCE_RATE))]
    noisy = degrade_caller_audio(frames, noise_snr_db=20, seed=1)
    assert noisy[0].sample_rate == SOURCE_RATE
    assert noisy[0].samples_per_channel == SOURCE_RATE
    assert _pcm(noisy).tobytes() != _pcm(frames).tobytes()


def test_unknown_profile_is_rejected():
    with pytest.raises(ValueError, match="unsupported caller audio profile"):
        degrade_caller_audio([_frame(_tone(700, rate=SOURCE_RATE))], profile="vinyl")
