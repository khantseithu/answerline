from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from .call_events import Slug

DEFAULT_AGENTS_DIR = Path(__file__).resolve().parents[4] / "agents"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    agent_name: str = "answerline"
    agents_dir: Path = DEFAULT_AGENTS_DIR
    default_agent: str = "bright-smile-dental"
    database_url: str | None = None
    redis_url: str = "redis://localhost:6379"
    redis_prefix: str = "bull"
    tenant: Slug = "default"
    turn_detection: Literal["local", "cloud", "stt", "vad"] = "local"
    interruption_mode: Literal["vad", "adaptive"] = "vad"
