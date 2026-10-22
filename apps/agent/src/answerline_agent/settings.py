from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_AGENTS_DIR = Path(__file__).resolve().parents[4] / "agents"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    agents_dir: Path = DEFAULT_AGENTS_DIR
    default_agent: str = "bright-smile-dental"
    database_url: str | None = None
    turn_detection: Literal["local", "cloud", "stt", "vad"] = "local"
    interruption_mode: Literal["vad", "adaptive"] = "vad"
