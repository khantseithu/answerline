from pathlib import Path

from answerline_agent.settings import DEFAULT_AGENTS_DIR, Settings


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
