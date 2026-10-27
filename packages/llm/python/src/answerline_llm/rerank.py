import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import NamedTuple

import httpx
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

RERANK_PROVIDERS = ("cohere", "jina")

RERANK_BASE_URLS = {
    "cohere": "https://api.cohere.com/v2",
    "jina": "https://api.jina.ai/v1",
}


class RerankResult(NamedTuple):
    index: int
    score: float


@dataclass(frozen=True)
class RerankModelRef:
    provider: str
    model: str


def parse_rerank_model_ref(ref: str) -> RerankModelRef:
    provider, _, model = ref.partition("/")
    if provider not in RERANK_PROVIDERS or not model or any(c.isspace() for c in ref):
        raise ValueError(f"Unsupported rerank model ref: {ref}")
    return RerankModelRef(provider, model)


class RerankSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    rerank_model: str | None = None
    rerank_base_url: HttpUrl | None = None
    cohere_api_key: SecretStr | None = None
    jina_api_key: SecretStr | None = None

    @field_validator("rerank_model", mode="before")
    @classmethod
    def validate_model(cls, value: object) -> object:
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        if not isinstance(value, str):
            return value
        parse_rerank_model_ref(value)
        return value

    @field_validator("rerank_base_url", mode="before")
    @classmethod
    def blank_base_url(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    def create_provider(
        self, *, client: httpx.AsyncClient | None = None
    ) -> "RerankProvider | None":
        if self.rerank_model is None:
            return None
        provider = parse_rerank_model_ref(self.rerank_model).provider
        key = {"cohere": self.cohere_api_key, "jina": self.jina_api_key}[provider]
        return create_rerank_provider(
            self.rerank_model,
            api_key=key.get_secret_value() if key else None,
            base_url=str(self.rerank_base_url) if self.rerank_base_url else None,
            client=client,
        )


class _Result(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, strict=True)

    index: int = Field(ge=0)
    score: float = Field(validation_alias="relevance_score")


class _TeiResult(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, strict=True)

    index: int = Field(ge=0)
    score: float


class _Response(BaseModel):
    results: list[_Result]


@dataclass(frozen=True)
class RerankProvider:
    model_ref: str
    _api_key: SecretStr | None
    _base_url: str
    _custom_base_url: bool
    _timeout_seconds: float
    _client: httpx.AsyncClient | None

    async def rerank(
        self, query: str, documents: Sequence[str], top_n: int | None = None
    ) -> list[RerankResult]:
        if not query.strip():
            raise ValueError("Rerank query must be a non-empty string")
        if isinstance(documents, str) or any(
            not isinstance(d, str) or not d.strip() for d in documents
        ):
            raise ValueError("Rerank documents must be a sequence of non-empty strings")
        if top_n is not None and top_n < 1:
            raise ValueError("top_n must be at least 1")
        if not documents:
            return []
        if self._client is not None:
            return await self._rerank(query, documents, top_n, self._client)
        async with httpx.AsyncClient() as client:
            return await self._rerank(query, documents, top_n, client)

    async def _rerank(
        self, query: str, documents: Sequence[str], top_n: int | None, client: httpx.AsyncClient
    ) -> list[RerankResult]:
        model = parse_rerank_model_ref(self.model_ref).model
        headers = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key.get_secret_value()}"
        body: dict[str, object] = {"model": model, "query": query, "documents": list(documents)}
        if self._custom_base_url:
            body["texts"] = list(documents)
        if top_n is not None:
            body["top_n"] = min(top_n, len(documents))
        response = await client.post(
            f"{self._base_url}/rerank",
            headers=headers,
            json=body,
            timeout=self._timeout_seconds,
        )
        if not response.is_success:
            raise RuntimeError(
                f"Rerank request failed ({self.model_ref}; HTTP {response.status_code})"
            )
        payload = response.json()
        if isinstance(payload, list):
            results = [
                RerankResult(item.index, item.score)
                for item in (_TeiResult.model_validate(entry) for entry in payload)
            ]
        else:
            results = [
                RerankResult(item.index, item.score)
                for item in _Response.model_validate(payload).results
            ]
        indices = [result.index for result in results]
        if len(set(indices)) != len(indices) or any(i >= len(documents) for i in indices):
            raise ValueError("Rerank response has duplicate or out-of-range indices")
        if not results:
            raise ValueError("Rerank response has no results")
        limit = len(documents) if top_n is None else min(top_n, len(documents))
        return sorted(results, key=lambda result: (-result.score, result.index))[:limit]


def create_rerank_provider(
    model_ref: str,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout_seconds: float = 10,
    client: httpx.AsyncClient | None = None,
) -> RerankProvider:
    provider = parse_rerank_model_ref(model_ref).provider
    if base_url is None and (api_key is None or not api_key.strip()):
        raise ValueError(f"Missing API key for rerank provider {provider}")
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("Rerank timeout must be positive and finite")
    url = str(HttpUrl(base_url or RERANK_BASE_URLS[provider])).rstrip("/")
    return RerankProvider(
        model_ref,
        SecretStr(api_key) if api_key and api_key.strip() else None,
        url,
        base_url is not None,
        timeout_seconds,
        client,
    )
