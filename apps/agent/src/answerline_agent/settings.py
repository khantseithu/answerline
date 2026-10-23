from pathlib import Path
from typing import Literal

from pydantic import Field
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
    max_call_duration_seconds: int = Field(default=900, ge=0)
    idle_timeout_seconds: int = Field(default=60, ge=0)
    drain_timeout_seconds: int | None = Field(default=None, ge=0)
    knowledge_search_timeout_seconds: float = Field(default=1.5, gt=0)
    knowledge_search_top_k: int = Field(default=4, ge=1, le=10)
    knowledge_min_similarity: float | None = Field(default=None, ge=-1, le=1)
    knowledge_min_keyword_terms: int = Field(default=2, ge=1, le=10)
    call_wrap_up_message: str = (
        "I'm sorry, we've reached the time limit for this call. Thank you for calling, and goodbye."
    )
    idle_check_in_message: str = "Are you still there?"
