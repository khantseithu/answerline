import openai
import pytest
from answerline_agent.config import LLMModels, Models
from answerline_agent.providers import build_llm_chain
from livekit.agents import llm

STT = "deepgram/nova-3"
TTS = "cartesia/sonic-3"


def models(primary: str, fallback: list[str]) -> Models:
    return Models(stt=STT, llm=LLMModels(primary=primary, fallback=fallback), tts=TTS)


@pytest.fixture
def only_anthropic_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)


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
