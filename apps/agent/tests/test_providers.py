import asyncio
import json

import httpx
import httpx2
import openai
import pytest
from answerline_agent.config import LLMModels, Models
from answerline_agent.providers import build_embedder, build_llm_chain
from livekit.agents import llm
from pydantic import ValidationError

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
        models("anthropic/claude-sonnet-4-6", ["openai/gpt-4.1-mini", "google/gemini-2.5-flash"])
    )
    assert not isinstance(chain, llm.FallbackAdapter)
    assert "skipping fallback LLM openai/gpt-4.1-mini" in caplog.text
    assert "skipping fallback LLM google/gemini-2.5-flash" in caplog.text


def test_keeps_available_fallbacks(only_anthropic_key, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    chain = build_llm_chain(
        models("anthropic/claude-sonnet-4-6", ["openai/gpt-4.1-mini", "google/gemini-2.5-flash"])
    )
    assert isinstance(chain, llm.FallbackAdapter)


def test_primary_without_credentials_still_fails(only_anthropic_key):
    with pytest.raises(openai.OpenAIError):
        build_llm_chain(models("openai/gpt-4.1-mini", []))


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


@pytest.mark.parametrize(
    ("endpoint", "expected_url"),
    [
        (None, "http://localhost:11434/v1/chat/completions"),
        ("http://ollama.internal:11434", "http://ollama.internal:11434/v1/chat/completions"),
        ("http://ollama.internal:11434/", "http://ollama.internal:11434/v1/chat/completions"),
        ("http://ollama.internal:11434/v1", "http://ollama.internal:11434/v1/chat/completions"),
        ("http://ollama.internal:11434/v1/", "http://ollama.internal:11434/v1/chat/completions"),
    ],
)
def test_ollama_chat_uses_configured_endpoint(monkeypatch, endpoint, expected_url):
    if endpoint is None:
        monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    else:
        monkeypatch.setenv("OLLAMA_BASE_URL", endpoint)
    requests = []

    async def respond(_transport, request):
        requests.append(str(request.url))
        chunk = {
            "id": "test",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "qwen3",
            "choices": [{"index": 0, "delta": {"content": "Hello"}, "finish_reason": "stop"}],
        }
        return httpx2.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n",
            request=request,
        )

    monkeypatch.setattr(httpx2.AsyncHTTPTransport, "handle_async_request", respond)

    async def scenario():
        model = build_llm_chain(models("ollama/qwen3", []))
        context = llm.ChatContext()
        context.add_message(role="user", content="Hello")
        try:
            async with model.chat(chat_ctx=context) as stream:
                async for _chunk in stream:
                    pass
        finally:
            await model.aclose()

    asyncio.run(scenario())
    assert requests == [expected_url]


@pytest.mark.parametrize("endpoint", ["invalid", "ftp://ollama.internal:11434"])
def test_ollama_rejects_invalid_endpoint_before_chat(monkeypatch, endpoint):
    monkeypatch.setenv("OLLAMA_BASE_URL", endpoint)
    with pytest.raises(ValidationError):
        build_llm_chain(models("ollama/qwen3", []))
