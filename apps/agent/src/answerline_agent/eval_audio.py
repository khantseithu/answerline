import numpy as np
from livekit import rtc

PHONE_SAMPLE_RATE = 8000
PHONE_BAND_HZ = (300.0, 3400.0)
BAND_ORDER = 4
MULAW_BIAS = 0x84
MULAW_CLIP = 32635


def resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate or samples.size == 0:
        return samples
    target_size = round(samples.size * target_rate / source_rate)
    spectrum = np.fft.rfft(samples)
    resized = np.zeros(target_size // 2 + 1, dtype=complex)
    kept = min(spectrum.size, resized.size)
    resized[:kept] = spectrum[:kept]
    return np.fft.irfft(resized, n=target_size) * (target_size / samples.size)


def band_pass(
    samples: np.ndarray,
    sample_rate: int,
    low_hz: float = PHONE_BAND_HZ[0],
    high_hz: float = PHONE_BAND_HZ[1],
    order: int = BAND_ORDER,
) -> np.ndarray:
    freqs = np.fft.rfftfreq(samples.size, d=1.0 / sample_rate)
    safe = np.maximum(freqs, 1e-9)
    high_pass = 1.0 / np.sqrt(1.0 + (low_hz / safe) ** (2 * order))
    low_pass = 1.0 / np.sqrt(1.0 + (freqs / high_hz) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(samples) * high_pass * low_pass, n=samples.size)


def mulaw_encode(pcm: np.ndarray) -> np.ndarray:
    values = pcm.astype(np.int32)
    sign = np.where(values < 0, 0x80, 0)
    magnitude = np.minimum(np.abs(values), MULAW_CLIP) + MULAW_BIAS
    exponent = np.frexp(magnitude.astype(np.float64))[1] - 8
    mantissa = (magnitude >> (exponent + 3)) & 0x0F
    return (~(sign | (exponent << 4) | mantissa) & 0xFF).astype(np.uint8)


def mulaw_decode(codes: np.ndarray) -> np.ndarray:
    inverted = ~codes.astype(np.int32) & 0xFF
    exponent = (inverted >> 4) & 0x07
    mantissa = inverted & 0x0F
    magnitude = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS
    return np.where(inverted & 0x80, -magnitude, magnitude).astype(np.int16)


def add_noise(
    samples: np.ndarray, snr_db: float, seed: int, reference: np.ndarray | None = None
) -> np.ndarray:
    reference = samples if reference is None else reference
    signal_rms = float(np.sqrt(np.mean(np.square(reference)))) if reference.size else 0.0
    if signal_rms == 0.0:
        return samples
    noise = np.random.default_rng(seed).standard_normal(samples.size)
    noise_rms = float(np.sqrt(np.mean(np.square(noise))))
    return samples + noise * (signal_rms / 10 ** (snr_db / 20) / noise_rms)


def _to_pcm(samples: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(samples), -32768, 32767).astype(np.int16)


def degrade_caller_audio(
    frames: list[rtc.AudioFrame],
    *,
    profile: str = "clean",
    noise_snr_db: float | None = None,
    seed: int = 0,
    padding_frames: int = 0,
) -> list[rtc.AudioFrame]:
    if profile not in {"clean", "phone"}:
        raise ValueError(f"unsupported caller audio profile {profile!r}")
    if not frames or (profile == "clean" and noise_snr_db is None):
        return frames
    sample_rate = frames[0].sample_rate
    channels = frames[0].num_channels
    pcm = np.concatenate([np.frombuffer(frame.data, dtype=np.int16) for frame in frames])
    speech_size = sum(
        frame.samples_per_channel * frame.num_channels
        for frame in frames[: len(frames) - padding_frames]
    )
    signal = pcm.astype(np.float64)
    if profile == "phone":
        signal = signal.reshape(-1, channels).mean(axis=1)
        speech_size = round(speech_size / channels * PHONE_SAMPLE_RATE / sample_rate)
        signal = resample(signal, sample_rate, PHONE_SAMPLE_RATE)
        signal = band_pass(signal, PHONE_SAMPLE_RATE)
        signal = mulaw_decode(mulaw_encode(_to_pcm(signal))).astype(np.float64)
        sample_rate, channels = PHONE_SAMPLE_RATE, 1
    if noise_snr_db is not None:
        signal = add_noise(signal, noise_snr_db, seed, signal[:speech_size])
    output = _to_pcm(signal)
    return [
        rtc.AudioFrame(
            data=output.tobytes(),
            sample_rate=sample_rate,
            num_channels=channels,
            samples_per_channel=output.size // channels,
        )
    ]
