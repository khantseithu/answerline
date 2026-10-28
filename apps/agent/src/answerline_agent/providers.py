import logging

import httpx
from answerline_llm import (
    EmbeddingProvider,
    EmbeddingSettings,
    RerankProvider,
    RerankSettings,
    create_embedding_provider,
    parse_model_ref,
)
from livekit.agents import llm, stt, tts
from livekit.plugins import anthropic, cartesia, deepgram, google, openai

from .config import Models
from .languages import base_language

logger = logging.getLogger("answerline.agent")


def build_stt(
    ref: str, provider_keys: dict[str, str] | None = None, *, language: str = "en"
) -> stt.STT:
    provider, _, model = ref.partition("/")
    if provider == "deepgram":
        return deepgram.STT(model=model, language=language, **_api_key("deepgram", provider_keys))
    raise ValueError(f"Unsupported STT provider: {ref}")


def build_tts(
    ref: str,
    provider_keys: dict[str, str] | None = None,
    *,
    language: str = "en",
    voice: str | None = None,
) -> tts.TTS:
    provider, _, model = ref.partition("/")
    if provider == "cartesia":
        return cartesia.TTS(
            model=model,
            language=base_language(language),
            **({"voice": voice} if voice else {}),
            **_api_key("cartesia", provider_keys),
        )
    raise ValueError(f"Unsupported TTS provider: {ref}")


def _api_key(provider: str, provider_keys: dict[str, str] | None) -> dict[str, str]:
    if provider_keys is None:
        return {}
    key = provider_keys.get(provider)
    if not key:
        raise ValueError(f"Missing API key for provider {provider}")
    return {"api_key": key}


def _ollama_openai_url() -> str:
    return f"{str(EmbeddingSettings().ollama_base_url).rstrip('/')}/v1"


def build_llm(ref: str, provider_keys: dict[str, str] | None = None) -> llm.LLM:
    m = parse_model_ref(ref)
    match m.provider:
        case "anthropic":
            return anthropic.LLM(model=m.model, **_api_key("anthropic", provider_keys))
        case "openai":
            return openai.LLM(model=m.model, **_api_key("openai", provider_keys))
        case "google":
            return google.LLM(model=m.model, **_api_key("google", provider_keys))
        case "deepseek":
            return openai.LLM.with_deepseek(model=m.model, **_api_key("deepseek", provider_keys))
        case "ollama":
            return openai.LLM.with_ollama(model=m.model, base_url=_ollama_openai_url())
        case "openrouter":
            return openai.LLM.with_openrouter(
                model=m.model, **_api_key("openrouter", provider_keys)
            )
    raise ValueError(f"Unsupported LLM provider: {ref}")


def build_llm_chain(models: Models, provider_keys: dict[str, str] | None = None) -> llm.LLM:
    chain = [build_llm(models.llm.primary, provider_keys)]
    for ref in models.llm.fallback:
        try:
            chain.append(build_llm(ref, provider_keys))
        except Exception as error:
            logger.warning("skipping fallback LLM %s: %s", ref, error)
    if len(chain) == 1:
        return chain[0]
    return llm.FallbackAdapter(chain)


def build_embedder(
    client: httpx.AsyncClient, provider_keys: dict[str, str] | None = None
) -> EmbeddingProvider:
    settings = EmbeddingSettings()
    model = parse_model_ref(settings.embedding_model)
    if model.provider == "ollama":
        api_key = None
    elif provider_keys is None:
        api_key = {
            "openai": settings.openai_api_key,
            "google": settings.google_api_key,
        }[model.provider]
        api_key = api_key.get_secret_value() if api_key else None
    else:
        api_key = provider_keys.get(model.provider, "")
    return create_embedding_provider(
        settings.embedding_model,
        api_key=api_key,
        base_url=str(settings.ollama_base_url) if model.provider == "ollama" else None,
        client=client,
        input_type="query",
    )


def build_reranker(client: httpx.AsyncClient) -> RerankProvider | None:
    return RerankSettings().create_provider(client=client)
