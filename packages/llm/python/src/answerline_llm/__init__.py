from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from .embeddings import (
    DEFAULT_EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_PROVIDERS,
    EmbeddingProvider,
    EmbeddingSettings,
    create_embedding_provider,
    parse_embedding_model_ref,
)
from .provider_credentials import decrypt_provider_credential, encrypt_provider_credential

__all__ = [
    "DEFAULT_EMBEDDING_MODEL",
    "EMBEDDING_DIMENSIONS",
    "EMBEDDING_PROVIDERS",
    "EmbeddingProvider",
    "EmbeddingSettings",
    "create_embedding_provider",
    "parse_embedding_model_ref",
    "decrypt_provider_credential",
    "encrypt_provider_credential",
    "PROVIDERS",
    "ModelRef",
    "parse_model_ref",
    "AllProvidersFailedError",
    "with_fallback",
]

PROVIDERS = ("anthropic", "openai", "google", "deepseek", "ollama", "openrouter")


@dataclass(frozen=True)
class ModelRef:
    provider: str
    model: str


def parse_model_ref(ref: str) -> ModelRef:
    provider, _, model = ref.partition("/")
    if provider not in PROVIDERS or not model:
        raise ValueError(f"Unsupported model ref: {ref}")
    return ModelRef(provider, model)


class AllProvidersFailedError(Exception):
    def __init__(self, failures: list[tuple[str, BaseException]]):
        self.failures = failures
        super().__init__(f"All LLM providers failed: {', '.join(r for r, _ in failures)}")


async def with_fallback[T](
    refs: list[str], call: Callable[[ModelRef], Awaitable[T]]
) -> tuple[str, T]:
    failures: list[tuple[str, BaseException]] = []
    for ref in refs:
        try:
            return ref, await call(parse_model_ref(ref))
        except Exception as error:
            failures.append((ref, error))
    raise AllProvidersFailedError(failures)
