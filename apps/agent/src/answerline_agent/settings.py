from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    agent_config: str = "agents/bright-smile-dental.yaml"
    database_url: str | None = None
