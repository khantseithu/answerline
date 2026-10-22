from answerline_agent.settings import Settings


def test_settings_read_environment(monkeypatch):
    monkeypatch.setenv("AGENT_CONFIG", "agents/other.yaml")
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@db:5432/x")
    settings = Settings()
    assert settings.agent_config == "agents/other.yaml"
    assert settings.database_url == "postgres://u:p@db:5432/x"


def test_settings_defaults(monkeypatch):
    monkeypatch.delenv("AGENT_CONFIG", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert Settings().agent_config == "agents/bright-smile-dental.yaml"
