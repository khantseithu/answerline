import logging

import httpx
from answerline_llm import EmbeddingProvider, EmbeddingSettings, parse_model_ref
from google.genai import types
from livekit.agents import llm, stt, tts
from livekit.plugins import anthropic, cartesia, deepgram, google, openai

from .config import Models

logger = logging.getLogger("answerline.agent")


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
            return google.LLM(model=m.model, http_options=types.HttpOptions(timeout=30_000))
        case "deepseek":
            return openai.LLM.with_deepseek(model=m.model)
        case "ollama":
            return openai.LLM.with_ollama(model=m.model)
        case "openrouter":
            return openai.LLM.with_openrouter(model=m.model)
    raise ValueError(f"Unsupported LLM provider: {ref}")


def build_llm_chain(models: Models) -> llm.LLM:
    chain = [build_llm(models.llm.primary)]
    for ref in models.llm.fallback:
        try:
            chain.append(build_llm(ref))
        except Exception as error:
            logger.warning("skipping fallback LLM %s: %s", ref, error)
    if len(chain) == 1:
        return chain[0]
    return llm.FallbackAdapter(chain)


def build_embedder(client: httpx.AsyncClient) -> EmbeddingProvider:
    return EmbeddingSettings().create_provider(client=client, input_type="query")
