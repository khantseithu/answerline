from pathlib import Path
from typing import Literal

from answerline_llm import EmbeddingSettings
from pydantic import Field
from pydantic_settings import SettingsConfigDict

from .call_events import Slug

DEFAULT_AGENTS_DIR = Path(__file__).resolve().parents[4] / "agents"


class Settings(EmbeddingSettings):
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
    max_call_duration_seconds: int = Field(default=900, ge=0)
    idle_timeout_seconds: int = Field(default=60, ge=0)
    drain_timeout_seconds: int | None = Field(default=None, ge=0)
    call_wrap_up_message: str = (
        "I'm sorry, we've reached the time limit for this call. Thank you for calling, and goodbye."
    )
    idle_check_in_message: str = "Are you still there?"
