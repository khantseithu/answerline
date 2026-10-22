from collections.abc import Awaitable, Callable
from dataclasses import dataclass

PROVIDERS = ("anthropic", "openai", "google", "deepseek", "ollama")


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
