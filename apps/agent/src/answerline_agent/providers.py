from answerline_llm import parse_model_ref
from livekit.agents import llm, stt, tts
from livekit.plugins import anthropic, cartesia, deepgram, google, openai

from .config import Models


def build_stt(ref: str) -> stt.STT:
    provider, _, model = ref.partition("/")
    if provider == "deepgram":
        return deepgram.STT(model=model)
    raise ValueError(f"Unsupported STT provider: {ref}")


def build_tts(ref: str) -> tts.TTS:
    provider, _, model = ref.partition("/")
    if provider == "cartesia":
        return cartesia.TTS(model=model)
    raise ValueError(f"Unsupported TTS provider: {ref}")


def build_llm(ref: str) -> llm.LLM:
    m = parse_model_ref(ref)
    match m.provider:
        case "anthropic":
            return anthropic.LLM(model=m.model)
        case "openai":
            return openai.LLM(model=m.model)
        case "google":
            return google.LLM(model=m.model)
        case "deepseek":
            return openai.LLM.with_deepseek(model=m.model)
        case "ollama":
            return openai.LLM.with_ollama(model=m.model)
    raise ValueError(f"Unsupported LLM provider: {ref}")


def build_llm_chain(models: Models) -> llm.LLM:
    refs = [models.llm.primary, *models.llm.fallback]
    if len(refs) == 1:
        return build_llm(refs[0])
    return llm.FallbackAdapter([build_llm(r) for r in refs])
