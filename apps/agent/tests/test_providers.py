import asyncio
import json

import httpx
import openai
import pytest
from answerline_agent import providers
from answerline_agent.config import LLMModels, Models
from answerline_agent.providers import (
    build_embedder,
    build_llm,
    build_llm_chain,
    build_reranker,
    build_stt,
    build_tts,
)
from livekit.agents import APIConnectionError, llm
from livekit.agents.types import APIConnectOptions
from livekit.agents.utils import is_given

STT = "deepgram/nova-3"
TTS = "cartesia/sonic-3"


def models(primary: str, fallback: list[str]) -> Models:
    return Models(stt=STT, llm=LLMModels(primary=primary, fallback=fallback), tts=TTS)


@pytest.fixture
def only_anthropic_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)


def test_skips_fallbacks_without_credentials(only_anthropic_key, caplog):
    chain = build_llm_chain(
        models("anthropic/claude-sonnet-4-6", ["openai/gpt-4.1-mini", "google/gemini-3.8-flash"])
    )
    assert not isinstance(chain, llm.FallbackAdapter)
    assert "skipping fallback LLM openai/gpt-4.1-mini" in caplog.text
    assert "skipping fallback LLM google/gemini-3.8-flash" in caplog.text


def test_keeps_available_fallbacks(only_anthropic_key, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    chain = build_llm_chain(
        models("anthropic/claude-sonnet-4-6", ["openai/gpt-4.1-mini", "google/gemini-3.8-flash"])
    )
    assert isinstance(chain, llm.FallbackAdapter)


def test_google_requests_use_a_supported_deadline_behind_the_fallback_adapter(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setenv("GOOGLE_API_KEY", "test")
    chain = build_llm_chain(models("google/gemini-3.8-flash", ["openai/gpt-4.1-mini"]))
    assert isinstance(chain, llm.FallbackAdapter)
    google_llm, openai_llm = chain._llm_instances
    google_deadlines = []
    openai_deadlines = []

    async def generate_content_stream(*, model, contents, config):
        google_deadlines.append(config.http_options.timeout)
        raise RuntimeError("stop after capturing the request")

    def openai_chat(**kwargs):
        openai_deadlines.append(int(kwargs["conn_options"].timeout * 1000))
        raise RuntimeError("stop after capturing the request")

    monkeypatch.setattr(
        google_llm._client.aio.models, "generate_content_stream", generate_content_stream
    )
    monkeypatch.setattr(openai_llm, "chat", openai_chat)

    async def scenario():
        async with chain.chat(chat_ctx=llm.ChatContext()) as stream:
            async for _ in stream:
                pass

    with pytest.raises(APIConnectionError):
        asyncio.run(scenario())
    assert set(google_deadlines) == {10_000}
    assert set(openai_deadlines) == {5_000}


def test_primary_without_credentials_still_fails(only_anthropic_key):
    with pytest.raises(openai.OpenAIError):
        build_llm_chain(models("openai/gpt-4.1-mini", []))


def test_build_llm_uses_the_workspace_key_instead_of_the_deployment_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "deployment-key")
    monkeypatch.setattr(providers.openai, "LLM", lambda **kwargs: kwargs)

    llm = build_llm("openai/gpt-4.1-mini", {"openai": "workspace-key"})

    assert llm["api_key"] == "workspace-key"


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        (None, "http://localhost:11434/v1"),
        ("http://ollama:11434", "http://ollama:11434/v1"),
        ("http://ollama:11434/", "http://ollama:11434/v1"),
    ],
)
def test_build_llm_forwards_the_ollama_base_url(monkeypatch, configured, expected):
    if configured is None:
        monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    else:
        monkeypatch.setenv("OLLAMA_BASE_URL", configured)

    ollama = build_llm("ollama/llama3.1")

    assert str(ollama._client.base_url) == f"{expected}/"


def test_workspace_provider_map_does_not_fall_back_to_ambient_keys(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "deployment-key")

    with pytest.raises(ValueError, match="Missing API key for provider openai"):
        build_llm("openai/gpt-4.1-mini", {})


def test_builds_openrouter_primary(only_anthropic_key, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    chain = build_llm_chain(models("openrouter/anthropic/claude-sonnet-4.5", []))
    assert chain.model == "anthropic/claude-sonnet-4.5"


def test_openrouter_fallback_needs_its_key(only_anthropic_key, monkeypatch, caplog):
    fallback = ["openrouter/anthropic/claude-sonnet-4.5"]
    chain = build_llm_chain(models("anthropic/claude-sonnet-4-6", fallback))
    assert not isinstance(chain, llm.FallbackAdapter)
    assert "skipping fallback LLM openrouter/anthropic/claude-sonnet-4.5" in caplog.text

    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    chain = build_llm_chain(models("anthropic/claude-sonnet-4-6", fallback))
    assert isinstance(chain, llm.FallbackAdapter)


def test_build_embedder_reuses_the_given_client(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("EMBEDDING_MODEL", "openai/text-embedding-3-small")
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0] * 1536}]})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            embedder = build_embedder(client)
            first = await embedder.embed(["hours"])
            await embedder.embed(["prices"])
            return first

    vectors = asyncio.run(scenario())
    assert len(requests) == 2
    assert len(vectors[0]) == 1536


def test_build_embedder_embeds_gemini_embedding_2_input_as_a_query(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("EMBEDDING_MODEL", "google/gemini-embedding-2")
    texts = []

    def handler(request: httpx.Request) -> httpx.Response:
        texts.extend(
            r["content"]["parts"][0]["text"] for r in json.loads(request.content)["requests"]
        )
        return httpx.Response(200, json={"embeddings": [{"values": [1.0] * 1536}]})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await build_embedder(client).embed(["hours"])

    asyncio.run(scenario())
    assert texts == ["task: search result | query: hours"]


def test_language_drives_stt_and_tts(monkeypatch):
    monkeypatch.setattr(providers.deepgram, "STT", lambda **kwargs: kwargs)
    monkeypatch.setattr(providers.cartesia, "TTS", lambda **kwargs: kwargs)

    stt = build_stt(STT, {"deepgram": "key"}, language="es-MX")
    tts = build_tts(TTS, {"cartesia": "key"}, language="es-MX")

    assert stt["language"] == "es-MX"
    assert tts["language"] == "es"


def test_stt_and_tts_default_to_english(monkeypatch):
    monkeypatch.setattr(providers.deepgram, "STT", lambda **kwargs: kwargs)
    monkeypatch.setattr(providers.cartesia, "TTS", lambda **kwargs: kwargs)

    assert build_stt(STT)["language"] == "en"
    assert build_tts(TTS)["language"] == "en"


def test_tts_voice_is_passed_only_when_set(monkeypatch):
    monkeypatch.setattr(providers.cartesia, "TTS", lambda **kwargs: kwargs)

    assert "voice" not in build_tts(TTS)
    assert "voice" not in build_tts(TTS, voice="")
    assert build_tts(TTS, voice="voice-123")["voice"] == "voice-123"


def test_build_reranker_is_off_unless_configured(monkeypatch):
    monkeypatch.delenv("RERANK_MODEL", raising=False)
    monkeypatch.setenv("COHERE_API_KEY", "test-key")

    async def scenario():
        async with httpx.AsyncClient() as client:
            return build_reranker(client)

    assert asyncio.run(scenario()) is None


def test_build_reranker_reuses_the_given_client(monkeypatch):
    monkeypatch.setenv("RERANK_MODEL", "jina/jina-reranker-v2-base-multilingual")
    monkeypatch.setenv("JINA_API_KEY", "test-key")
    monkeypatch.delenv("RERANK_BASE_URL", raising=False)
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"results": [{"index": 1, "relevance_score": 0.8}]})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            reranker = build_reranker(client)
            return await reranker.rerank("hours", ["a", "b"], 1)

    results = asyncio.run(scenario())
    assert [(r.index, r.score) for r in results] == [(1, 0.8)]
    assert str(requests[0].url) == "https://api.jina.ai/v1/rerank"


def test_build_reranker_needs_a_key_unless_self_hosted(monkeypatch):
    monkeypatch.setenv("RERANK_MODEL", "cohere/rerank-v3.5")
    monkeypatch.delenv("COHERE_API_KEY", raising=False)
    monkeypatch.delenv("RERANK_BASE_URL", raising=False)

    async def scenario():
        async with httpx.AsyncClient() as client:
            return build_reranker(client)

    with pytest.raises(ValueError, match="Missing API key"):
        asyncio.run(scenario())
    monkeypatch.setenv("RERANK_BASE_URL", "http://tei:8080")
    assert asyncio.run(scenario()) is not None


def _captured_chat_body(instance, base_url: str) -> dict:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(500, json={"error": {"message": "stop"}})

    instance._client = openai.AsyncClient(
        api_key="key",
        base_url=base_url,
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    async def scenario():
        stream = instance.chat(
            chat_ctx=llm.ChatContext(items=[llm.ChatMessage(role="user", content=["Hello"])]),
            conn_options=APIConnectOptions(max_retry=0, retry_interval=0, timeout=5),
        )
        try:
            async for _ in stream:
                pass
        except Exception:
            pass
        finally:
            await stream.aclose()

    asyncio.run(scenario())
    return bodies[0]


KEYS = {"openai": "k", "openrouter": "k", "deepseek": "k"}


@pytest.mark.parametrize(
    ("ref", "field", "base_url"),
    [
        ("openai/gpt-4.1-mini", "max_completion_tokens", "https://api.openai.com/v1"),
        ("openrouter/openai/gpt-4.1-mini", "max_completion_tokens", "https://openrouter.ai/api/v1"),
        ("ollama/llama3.1", "max_completion_tokens", "http://localhost:11434/v1"),
        ("deepseek/deepseek-chat", "max_tokens", "https://api.deepseek.com/v1"),
    ],
)
def test_build_llm_sends_the_completion_budget_with_the_provider_field(ref, field, base_url):
    bounded = _captured_chat_body(build_llm(ref, KEYS, max_output_tokens=777), base_url)
    assert bounded[field] == 777

    unbounded = _captured_chat_body(build_llm(ref, KEYS), base_url)
    assert "max_tokens" not in unbounded
    assert "max_completion_tokens" not in unbounded


def test_build_llm_sets_the_native_budget_option_for_anthropic_and_google():
    anthropic_llm = build_llm(
        "anthropic/claude-sonnet-4-6", {"anthropic": "k"}, max_output_tokens=777
    )
    google_llm = build_llm("google/gemini-2.5-flash", {"google": "k"}, max_output_tokens=777)

    assert anthropic_llm._opts.max_tokens == 777
    assert google_llm._opts.max_output_tokens == 777


def test_build_llm_leaves_provider_defaults_without_a_budget():
    anthropic_llm = build_llm("anthropic/claude-sonnet-4-6", {"anthropic": "k"})
    google_llm = build_llm("google/gemini-2.5-flash", {"google": "k"})

    assert not is_given(anthropic_llm._opts.max_tokens)
    assert not is_given(google_llm._opts.max_output_tokens)


def test_build_llm_chain_bounds_every_model_in_the_chain(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("OPENAI_API_KEY", "test")

    chain = build_llm_chain(
        models("anthropic/claude-sonnet-4-6", ["openai/gpt-4.1-mini"]), max_output_tokens=777
    )

    primary, fallback = chain._llm_instances
    assert primary._opts.max_tokens == 777
    assert fallback._opts.max_completion_tokens == 777
