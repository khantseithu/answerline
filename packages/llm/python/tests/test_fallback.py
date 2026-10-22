import asyncio

import pytest
from answerline_llm import AllProvidersFailedError, ModelRef, parse_model_ref, with_fallback


def test_parse_model_ref():
    assert parse_model_ref("ollama/llama3.1:8b") == ModelRef("ollama", "llama3.1:8b")
    with pytest.raises(ValueError):
        parse_model_ref("acme/foo")


def test_falls_back_on_failure():
    async def call(m: ModelRef) -> str:
        if m.provider == "anthropic":
            raise RuntimeError("down")
        return m.model

    assert asyncio.run(with_fallback(["anthropic/a", "openai/b"], call)) == ("openai/b", "b")


def test_raises_when_all_fail():
    async def call(m: ModelRef) -> str:
        raise RuntimeError("down")

    with pytest.raises(AllProvidersFailedError):
        asyncio.run(with_fallback(["anthropic/a"], call))
