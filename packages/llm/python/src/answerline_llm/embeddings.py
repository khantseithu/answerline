import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EMBEDDING_DIMENSIONS = 1536
DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_PROVIDERS = ("openai", "google", "ollama")


def parse_embedding_model_ref(ref: str):
    from . import parse_model_ref

    parsed = parse_model_ref(ref)
    if parsed.provider not in EMBEDDING_PROVIDERS or any(c.isspace() for c in ref):
        raise ValueError(f"Unsupported embedding model ref: {ref}")
    return parsed


class EmbeddingSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    embedding_model: str = DEFAULT_EMBEDDING_MODEL
    openai_api_key: SecretStr | None = None
    google_api_key: SecretStr | None = None
    ollama_base_url: HttpUrl = HttpUrl("http://localhost:11434")

    @field_validator("embedding_model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        parse_embedding_model_ref(value)
        return value

    def create_provider(self, *, client: httpx.AsyncClient | None = None):
        provider = parse_embedding_model_ref(self.embedding_model).provider
        key = self.openai_api_key if provider == "openai" else self.google_api_key
        return create_embedding_provider(
            self.embedding_model,
            api_key=key.get_secret_value() if key else None,
            base_url=str(self.ollama_base_url) if provider == "ollama" else None,
            client=client,
        )


class _Vector(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, strict=True)

    values: list[float]


class _OpenAIItem(_Vector):
    values: list[float] = Field(validation_alias="embedding")
    index: int = Field(ge=0)


class _OpenAIResponse(BaseModel):
    data: list[_OpenAIItem]


class _GoogleResponse(BaseModel):
    embeddings: list[_Vector]


class _OllamaResponse(BaseModel):
    embeddings: list[list[float]]
    model_config = ConfigDict(allow_inf_nan=False, strict=True)


def _normalize(vector: list[float]) -> list[float]:
    if len(vector) < EMBEDDING_DIMENSIONS:
        raise ValueError(f"Embedding model returned {len(vector)} dimensions; need at least 1536")
    reduced = vector[:EMBEDDING_DIMENSIONS]
    norm = math.hypot(*reduced)
    if not math.isfinite(norm) or norm == 0:
        raise ValueError("Embedding model returned a zero or invalid vector")
    return [value / norm for value in reduced]


@dataclass(frozen=True)
class EmbeddingProvider:
    model_ref: str
    _api_key: SecretStr | None
    _base_url: str
    _timeout_seconds: float
    _client: httpx.AsyncClient | None
    dimensions: Literal[1536] = EMBEDDING_DIMENSIONS

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if isinstance(texts, str) or any(not isinstance(t, str) or not t.strip() for t in texts):
            raise ValueError("Embedding input must be a sequence of non-empty strings")
        if not texts:
            return []
        if self._client is not None:
            return await self._embed_batches(texts, self._client)
        async with httpx.AsyncClient() as client:
            return await self._embed_batches(texts, client)

    async def _embed_batches(
        self, texts: Sequence[str], client: httpx.AsyncClient
    ) -> list[list[float]]:
        vectors = []
        for offset in range(0, len(texts), 100):
            vectors.extend(await self._embed_batch(texts[offset : offset + 100], client))
        return vectors

    async def _embed_batch(
        self, texts: Sequence[str], client: httpx.AsyncClient
    ) -> list[list[float]]:
        parsed = parse_embedding_model_ref(self.model_ref)
        model, provider = parsed.model, parsed.provider
        headers = {}
        body: dict[str, object]
        if provider == "openai":
            path = "/embeddings"
            headers["Authorization"] = f"Bearer {self._api_key.get_secret_value()}"
            body = {"input": list(texts), "model": model, "encoding_format": "float"}
            if model.startswith("text-embedding-3-"):
                body["dimensions"] = EMBEDDING_DIMENSIONS
        elif provider == "google":
            path = f"/models/{quote(model, safe='')}:batchEmbedContents"
            headers["x-goog-api-key"] = self._api_key.get_secret_value()
            body = {
                "requests": [
                    {
                        "model": f"models/{model}",
                        "content": {"parts": [{"text": text}]},
                        "outputDimensionality": EMBEDDING_DIMENSIONS,
                    }
                    for text in texts
                ]
            }
        else:
            path = "/api/embed"
            body = {
                "dimensions": EMBEDDING_DIMENSIONS,
                "input": list(texts),
                "model": model,
                "truncate": False,
            }
        response = await client.post(
            f"{self._base_url}{path}",
            headers=headers,
            json=body,
            timeout=self._timeout_seconds,
        )
        if not response.is_success:
            raise RuntimeError(
                f"Embedding request failed ({self.model_ref}; HTTP {response.status_code})"
            )
        payload = response.json()
        if provider == "openai":
            data = _OpenAIResponse.model_validate(payload).data
            indices = {item.index for item in data}
            if indices != set(range(len(texts))) or len(data) != len(texts):
                raise ValueError("Embedding response has missing or duplicate indices")
            vectors = [item.values for item in sorted(data, key=lambda item: item.index)]
        elif provider == "google":
            vectors = [item.values for item in _GoogleResponse.model_validate(payload).embeddings]
        else:
            vectors = _OllamaResponse.model_validate(payload).embeddings
        if len(vectors) != len(texts):
            raise ValueError(
                f"Embedding response count mismatch: expected {len(texts)}, got {len(vectors)}"
            )
        return [_normalize(vector) for vector in vectors]


def create_embedding_provider(
    model_ref: str = DEFAULT_EMBEDDING_MODEL,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout_seconds: float = 10,
    client: httpx.AsyncClient | None = None,
) -> EmbeddingProvider:
    provider = parse_embedding_model_ref(model_ref).provider
    if provider != "ollama" and (api_key is None or not api_key.strip()):
        raise ValueError(f"Missing API key for embedding provider {provider}")
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("Embedding timeout must be positive and finite")
    defaults = {
        "openai": "https://api.openai.com/v1",
        "google": "https://generativelanguage.googleapis.com/v1beta",
        "ollama": "http://localhost:11434",
    }
    url = str(HttpUrl(base_url or defaults[provider])).rstrip("/")
    return EmbeddingProvider(
        model_ref, SecretStr(api_key) if api_key else None, url, timeout_seconds, client
    )
