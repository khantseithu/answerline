import asyncio
import json
import math

import httpx
import pytest
from answerline_llm import (
    DEFAULT_EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
    EmbeddingSettings,
    create_embedding_provider,
    parse_embedding_model_ref,
)


def vector(size=1536, value=1.0):
    return [value] * size


def openai_payload(vectors):
    return {"data": [{"index": i, "embedding": v} for i, v in enumerate(vectors)]}


def run_embed(handler, *, model=DEFAULT_EMBEDDING_MODEL, texts=None, **options):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = create_embedding_provider(model, api_key="test", client=client, **options)
            assert provider.dimensions == EMBEDDING_DIMENSIONS
            assert provider.model_ref == model
            return await provider.embed(texts if texts is not None else ["a"])

    return asyncio.run(run())


def assert_unit_vectors(vectors):
    for embedding in vectors:
        assert len(embedding) == EMBEDDING_DIMENSIONS
        assert math.hypot(*embedding) == pytest.approx(1)


def test_model_refs_and_env(monkeypatch):
    for name in ("EMBEDDING_MODEL", "OPENAI_API_KEY", "GOOGLE_API_KEY", "OLLAMA_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    settings = EmbeddingSettings()
    assert settings.embedding_model == DEFAULT_EMBEDDING_MODEL
    with pytest.raises(ValueError, match="Missing API key"):
        settings.create_provider()
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    assert EmbeddingSettings().create_provider().model_ref == DEFAULT_EMBEDDING_MODEL
    assert "test-secret" not in repr(EmbeddingSettings())
    assert "test-secret" not in repr(EmbeddingSettings().create_provider())
    monkeypatch.setenv("EMBEDDING_MODEL", "google/gemini-embedding-001")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-test")
    assert EmbeddingSettings().create_provider().model_ref == "google/gemini-embedding-001"
    monkeypatch.setenv("EMBEDDING_MODEL", "ollama/qwen3-embedding:4b")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://local:11434")
    assert EmbeddingSettings().create_provider().model_ref == "ollama/qwen3-embedding:4b"
    assert parse_embedding_model_ref("ollama/org/model:tag").model == "org/model:tag"
    for ref in ("anthropic/a", "gemini/a", "openai/", "openai/a b"):
        with pytest.raises(ValueError):
            parse_embedding_model_ref(ref)
        with pytest.raises(ValueError):
            EmbeddingSettings(embedding_model=ref)
    with pytest.raises(ValueError):
        EmbeddingSettings(ollama_base_url="invalid")


def test_openai_native_dimensions_and_batch_order():
    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/embeddings"
        assert request.method == "POST"
        assert request.headers["authorization"] == "Bearer test"
        assert request.extensions["timeout"]["read"] == 10
        assert json.loads(request.content) == {
            "model": "text-embedding-3-small",
            "input": ["a", "b"],
            "dimensions": 1536,
            "encoding_format": "float",
        }
        return httpx.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": vector(value=-1)},
                    {"index": 0, "embedding": vector()},
                ]
            },
        )

    result = run_embed(handler, texts=["a", "b"])
    assert_unit_vectors(result)
    assert result[0][0] > 0
    assert result[1][0] < 0


def test_legacy_openai_omits_dimensions():
    def handler(request):
        assert "dimensions" not in json.loads(request.content)
        return httpx.Response(200, json=openai_payload([vector()]))

    assert_unit_vectors(run_embed(handler, model="openai/text-embedding-ada-002"))


def test_gemini_native_dimensions():
    def handler(request):
        assert str(request.url) == (
            "https://generativelanguage.googleapis.com/v1beta/"
            "models/gemini-embedding-001:batchEmbedContents"
        )
        assert request.headers["x-goog-api-key"] == "test"
        assert json.loads(request.content) == {
            "requests": [
                {
                    "model": "models/gemini-embedding-001",
                    "content": {"parts": [{"text": text}]},
                    "outputDimensionality": 1536,
                }
                for text in ["a", "b"]
            ]
        }
        return httpx.Response(
            200, json={"embeddings": [{"values": vector()}, {"values": vector(3072, -2)}]}
        )

    assert_unit_vectors(run_embed(handler, model="google/gemini-embedding-001", texts=["a", "b"]))


def test_ollama_truncates_then_normalizes():
    def handler(request):
        assert str(request.url) == "http://local:11434/api/embed"
        assert "authorization" not in request.headers
        assert json.loads(request.content) == {
            "dimensions": 1536,
            "model": "qwen3-embedding:4b",
            "input": ["a"],
            "truncate": False,
        }
        return httpx.Response(200, json={"embeddings": [vector(1536, 2) + vector(1024, 100)]})

    result = run_embed(handler, model="ollama/qwen3-embedding:4b", base_url="http://local:11434/")
    assert_unit_vectors(result)
    assert result[0][0] == pytest.approx(1 / math.sqrt(1536))


def test_bounded_batch_and_empty_input():
    sizes = []

    def handler(request):
        texts = json.loads(request.content)["input"]
        sizes.append(len(texts))
        return httpx.Response(200, json=openai_payload([vector() for _ in texts]))

    assert run_embed(handler, texts=[]) == []
    assert sizes == []
    result = run_embed(handler, texts=[f"text {i}" for i in range(101)])
    assert sizes == [100, 1]
    assert len(result) == 101
    with pytest.raises(ValueError, match="non-empty strings"):
        run_embed(handler, texts=[" "])
    with pytest.raises(ValueError, match="sequence"):
        run_embed(handler, texts="not a batch")


@pytest.mark.parametrize(
    "payload",
    [
        openai_payload([vector(768)]),
        openai_payload([vector(value=0)]),
        openai_payload([[*vector(1535), None]]),
        openai_payload([["1"] * 1536]),
        {"data": [{"index": 1, "embedding": vector()}]},
        {"data": [{"index": 0, "embedding": vector()}, {"index": 0, "embedding": vector()}]},
        {"data": []},
        {},
    ],
)
def test_rejects_invalid_openai_response(payload):
    with pytest.raises(ValueError):
        run_embed(lambda _: httpx.Response(200, json=payload))


@pytest.mark.parametrize(
    "model,payload,message",
    [
        ("ollama/small", {"embeddings": [vector(768)]}, "768 dimensions; need at least 1536"),
        ("google/gemini-embedding-001", {"embeddings": []}, "count mismatch"),
        ("ollama/large", {"embeddings": [vector() + [float("nan")]]}, "finite"),
    ],
)
def test_rejects_invalid_other_response(model, payload, message):
    def handler(_):
        return httpx.Response(200, content=json.dumps(payload))

    with pytest.raises(ValueError, match=message):
        run_embed(handler, model=model)


def test_credentials_and_timeout_validation():
    with pytest.raises(ValueError, match="Missing API key"):
        create_embedding_provider()
    with pytest.raises(ValueError, match="Missing API key"):
        create_embedding_provider(api_key=" ")
    with pytest.raises(ValueError):
        create_embedding_provider("anthropic/a")
    for timeout in (0, -1, float("inf"), float("nan")):
        with pytest.raises(ValueError, match="timeout"):
            create_embedding_provider(api_key="test", timeout_seconds=timeout)


def test_http_errors_do_not_echo_provider_body():
    with pytest.raises(RuntimeError, match="HTTP 429") as error:
        run_embed(lambda _: httpx.Response(429, text="sensitive provider error"))
    assert "sensitive provider error" not in str(error.value)


@pytest.mark.parametrize("error", [httpx.ConnectError("down"), httpx.ReadTimeout("timed out")])
def test_transport_errors_and_timeouts(error):
    def handler(_):
        raise error

    with pytest.raises(type(error)):
        run_embed(handler)
