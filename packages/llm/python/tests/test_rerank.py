import asyncio
import json

import httpx
import pytest
from answerline_llm import (
    RerankResult,
    RerankSettings,
    create_rerank_provider,
    parse_rerank_model_ref,
)

COHERE_MODEL = "cohere/rerank-v3.5"
JINA_MODEL = "jina/jina-reranker-v2-base-multilingual"
DOCS = ["open nine to five", "closed on sundays", "parking is free"]


def run_rerank(handler, *, model=COHERE_MODEL, documents=DOCS, top_n=None, **options):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = create_rerank_provider(model, api_key="test", client=client, **options)
            assert provider.model_ref == model
            return await provider.rerank("when are you open", documents, top_n)

    return asyncio.run(run())


def results_payload(*pairs):
    return {"results": [{"index": i, "relevance_score": s} for i, s in pairs]}


def test_model_refs_and_env(monkeypatch):
    for name in ("RERANK_MODEL", "RERANK_BASE_URL", "COHERE_API_KEY", "JINA_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert RerankSettings().rerank_model is None
    assert RerankSettings().create_provider() is None
    monkeypatch.setenv("RERANK_MODEL", "")
    assert RerankSettings().create_provider() is None
    monkeypatch.setenv("RERANK_MODEL", COHERE_MODEL)
    with pytest.raises(ValueError, match="Missing API key"):
        RerankSettings().create_provider()
    monkeypatch.setenv("COHERE_API_KEY", "test-secret")
    provider = RerankSettings().create_provider()
    assert provider.model_ref == COHERE_MODEL
    assert "test-secret" not in repr(RerankSettings())
    assert "test-secret" not in repr(provider)
    monkeypatch.setenv("RERANK_MODEL", JINA_MODEL)
    with pytest.raises(ValueError, match="Missing API key"):
        RerankSettings().create_provider()
    monkeypatch.setenv("RERANK_BASE_URL", "http://tei:8080")
    assert RerankSettings().create_provider()._api_key is None
    monkeypatch.setenv("RERANK_BASE_URL", "")
    assert RerankSettings().rerank_base_url is None
    assert parse_rerank_model_ref("jina/org/model").model == "org/model"
    for ref in ("openai/a", "cohere/", "cohere", "cohere/a b"):
        with pytest.raises(ValueError):
            parse_rerank_model_ref(ref)
        with pytest.raises(ValueError):
            RerankSettings(rerank_model=ref)
    with pytest.raises(ValueError):
        RerankSettings(rerank_base_url="invalid")


def test_cohere_request_shape_and_ordering():
    def handler(request):
        assert str(request.url) == "https://api.cohere.com/v2/rerank"
        assert request.method == "POST"
        assert request.headers["authorization"] == "Bearer test"
        assert request.extensions["timeout"]["read"] == 10
        assert json.loads(request.content) == {
            "model": "rerank-v3.5",
            "query": "when are you open",
            "documents": DOCS,
            "top_n": 2,
        }
        return httpx.Response(200, json=results_payload((2, 0.1), (0, 0.9), (1, 0.4)))

    assert run_rerank(handler, top_n=2) == [RerankResult(0, 0.9), RerankResult(1, 0.4)]


def test_jina_request_shape():
    def handler(request):
        assert str(request.url) == "https://api.jina.ai/v1/rerank"
        assert request.headers["authorization"] == "Bearer test"
        body = json.loads(request.content)
        assert body == {
            "model": "jina-reranker-v2-base-multilingual",
            "query": "when are you open",
            "documents": DOCS,
        }
        payload = results_payload((1, 0.8), (0, 0.3), (2, 0.2))
        payload["usage"] = {"total_tokens": 12}
        for item in payload["results"]:
            item["document"] = {"text": DOCS[item["index"]]}
        return httpx.Response(200, json=payload)

    results = run_rerank(handler, model=JINA_MODEL)
    assert [r.index for r in results] == [1, 0, 2]


def test_top_n_is_capped_to_the_document_count():
    def handler(request):
        assert json.loads(request.content)["top_n"] == 3
        return httpx.Response(200, json=results_payload((0, 0.5)))

    assert run_rerank(handler, top_n=10) == [RerankResult(0, 0.5)]


def test_self_hosted_base_url_sends_texts_and_parses_bare_list_responses():
    def handler(request):
        assert str(request.url) == "http://tei:8080/rerank"
        assert "authorization" not in request.headers
        body = json.loads(request.content)
        assert body["texts"] == body["documents"] == DOCS
        return httpx.Response(200, json=[{"index": 1, "score": 0.7}, {"index": 0, "score": 0.9}])

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = create_rerank_provider(
                COHERE_MODEL, base_url="http://tei:8080/", client=client
            )
            return await provider.rerank("q", DOCS)

    assert asyncio.run(run()) == [RerankResult(0, 0.9), RerankResult(1, 0.7)]


def test_self_hosted_base_url_with_a_key_sends_the_bearer_token():
    def handler(request):
        assert str(request.url) == "http://infinity:7997/rerank"
        assert request.headers["authorization"] == "Bearer test"
        return httpx.Response(200, json=results_payload((0, 0.5)))

    assert run_rerank(handler, base_url="http://infinity:7997") == [RerankResult(0, 0.5)]


def test_empty_documents_skip_the_request():
    def handler(request):
        raise AssertionError("no request expected")

    assert run_rerank(handler, documents=[]) == []


def test_invalid_input_is_rejected_before_any_request():
    def handler(request):
        raise AssertionError("no request expected")

    for documents in (["a", " "], "abc"):
        with pytest.raises(ValueError, match="non-empty strings"):
            run_rerank(handler, documents=documents)
    with pytest.raises(ValueError, match="top_n"):
        run_rerank(handler, top_n=0)


@pytest.mark.parametrize("status", [401, 429, 500])
def test_http_errors_do_not_leak_the_response_body(status):
    def handler(request):
        return httpx.Response(status, text="secret-body Bearer test")

    with pytest.raises(RuntimeError, match=f"HTTP {status}") as error:
        run_rerank(handler)
    assert "secret-body" not in str(error.value)


@pytest.mark.parametrize(
    "payload",
    [
        {"results": []},
        {"results": [{"index": 0}]},
        {"results": [{"index": 5, "relevance_score": 0.5}]},
        {"results": [{"index": 0, "relevance_score": 0.5}, {"index": 0, "relevance_score": 0.4}]},
        {"results": [{"index": -1, "relevance_score": 0.5}]},
        {"results": [{"index": 0, "relevance_score": "high"}]},
        {"data": []},
    ],
)
def test_malformed_responses_raise(payload):
    with pytest.raises(ValueError):
        run_rerank(lambda request: httpx.Response(200, json=payload))


def test_transport_errors_propagate():
    def handler(request):
        raise httpx.ConnectTimeout("timed out")

    with pytest.raises(httpx.ConnectTimeout):
        run_rerank(handler)


def test_provider_options_are_validated():
    with pytest.raises(ValueError, match="Missing API key"):
        create_rerank_provider(COHERE_MODEL, api_key=" ")
    with pytest.raises(ValueError, match="timeout"):
        create_rerank_provider(COHERE_MODEL, api_key="k", timeout_seconds=0)
