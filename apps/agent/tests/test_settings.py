from pathlib import Path

import pytest
from answerline_agent.settings import DEFAULT_AGENTS_DIR, Settings
from pydantic import ValidationError


def test_agent_name_defaults_and_overrides(monkeypatch):
    monkeypatch.delenv("AGENT_NAME", raising=False)
    assert Settings().agent_name == "answerline"
    monkeypatch.setenv("AGENT_NAME", "answerline-feature-x")
    assert Settings().agent_name == "answerline-feature-x"


def test_settings_read_environment(monkeypatch):
    monkeypatch.setenv("AGENTS_DIR", "/srv/agents")
    monkeypatch.setenv("DEFAULT_AGENT", "other")
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@db:5432/x")
    settings = Settings()
    assert settings.agents_dir == Path("/srv/agents")
    assert settings.default_agent == "other"
    assert settings.database_url == "postgres://u:p@db:5432/x"


def test_settings_defaults(monkeypatch):
    monkeypatch.delenv("AGENTS_DIR", raising=False)
    monkeypatch.delenv("DEFAULT_AGENT", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    settings = Settings()
    assert settings.agents_dir == DEFAULT_AGENTS_DIR
    assert settings.default_agent == "bright-smile-dental"
    assert settings.database_url is None


def test_event_publishing_settings(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_PREFIX", raising=False)
    monkeypatch.delenv("TENANT", raising=False)
    settings = Settings()
    assert settings.redis_url == "redis://localhost:6379"
    assert settings.redis_prefix == "bull"
    assert settings.tenant == "default"
    monkeypatch.setenv("REDIS_URL", "redis://r:6379")
    monkeypatch.setenv("REDIS_PREFIX", "bull-wt9")
    monkeypatch.setenv("TENANT", "acme")
    settings = Settings()
    assert settings.redis_url == "redis://r:6379"
    assert settings.redis_prefix == "bull-wt9"
    assert settings.tenant == "acme"


def test_tenant_must_be_a_slug(monkeypatch):
    monkeypatch.setenv("TENANT", "Not A Slug")
    with pytest.raises(ValidationError):
        Settings()


def test_knowledge_search_defaults_and_overrides(monkeypatch):
    monkeypatch.delenv("KNOWLEDGE_SEARCH_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("KNOWLEDGE_SEARCH_TOP_K", raising=False)
    settings = Settings()
    assert settings.knowledge_search_timeout_seconds == 1.5
    assert settings.knowledge_search_top_k == 4
    monkeypatch.setenv("KNOWLEDGE_SEARCH_TIMEOUT_SECONDS", "0.8")
    monkeypatch.setenv("KNOWLEDGE_SEARCH_TOP_K", "6")
    settings = Settings()
    assert settings.knowledge_search_timeout_seconds == 0.8
    assert settings.knowledge_search_top_k == 6
    monkeypatch.setenv("KNOWLEDGE_SEARCH_TIMEOUT_SECONDS", "0")
    with pytest.raises(ValidationError):
        Settings()


def test_knowledge_relevance_floor_is_off_by_default(monkeypatch):
    monkeypatch.delenv("KNOWLEDGE_MIN_SIMILARITY", raising=False)
    monkeypatch.delenv("KNOWLEDGE_MIN_KEYWORD_TERMS", raising=False)
    settings = Settings()
    assert settings.knowledge_min_similarity is None
    assert settings.knowledge_min_keyword_terms == 2
    monkeypatch.setenv("KNOWLEDGE_MIN_SIMILARITY", "0.35")
    monkeypatch.setenv("KNOWLEDGE_MIN_KEYWORD_TERMS", "3")
    settings = Settings()
    assert settings.knowledge_min_similarity == 0.35
    assert settings.knowledge_min_keyword_terms == 3
    monkeypatch.setenv("KNOWLEDGE_MIN_SIMILARITY", "1.5")
    with pytest.raises(ValidationError):
        Settings()


def test_tool_execution_defaults_and_overrides(monkeypatch):
    for name in ("TOOL_TIMEOUT_SECONDS", "TOOL_RETRIES", "TOOL_FILLER_DELAY_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings()
    assert settings.tool_timeout_seconds == 10
    assert settings.tool_retries == 1
    assert settings.tool_filler_delay_seconds == 0.8
    monkeypatch.setenv("TOOL_TIMEOUT_SECONDS", "3")
    monkeypatch.setenv("TOOL_RETRIES", "2")
    monkeypatch.setenv("TOOL_FILLER_DELAY_SECONDS", "0.5")
    settings = Settings()
    assert settings.tool_timeout_seconds == 3
    assert settings.tool_retries == 2
    assert settings.tool_filler_delay_seconds == 0.5


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("TOOL_TIMEOUT_SECONDS", "0"),
        ("TOOL_TIMEOUT_SECONDS", "inf"),
        ("TOOL_TIMEOUT_SECONDS", "nan"),
        ("TOOL_RETRIES", "4"),
        ("TOOL_FILLER_DELAY_SECONDS", "-1"),
        ("TOOL_FILLER_DELAY_SECONDS", "inf"),
        ("TOOL_FILLER_DELAY_SECONDS", "nan"),
    ],
)
def test_invalid_tool_execution_settings_are_rejected(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        Settings()
