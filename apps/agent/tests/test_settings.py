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
