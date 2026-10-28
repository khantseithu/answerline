from pathlib import Path
from typing import Literal

from pydantic import Field, HttpUrl, SecretStr
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
    provider_keys_encryption_key: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None
    cartesia_api_key: SecretStr | None = None
    deepgram_api_key: SecretStr | None = None
    deepseek_api_key: SecretStr | None = None
    google_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None
    otel_exporter_otlp_endpoint: HttpUrl | None = None
    otel_exporter_otlp_traces_endpoint: HttpUrl | None = None
    otel_service_name: str = Field(default="answerline-agent", min_length=1)
    otel_exporter_otlp_timeout: float = Field(default=5.0, gt=0, allow_inf_nan=False)
    eval_judge_model: str | None = None
    eval_reference_stt: str | None = None
    turn_detection: Literal["local", "cloud", "stt", "vad"] = "local"
    interruption_mode: Literal["vad", "adaptive"] = "vad"
    max_call_duration_seconds: int = Field(default=900, ge=0)
    idle_timeout_seconds: int = Field(default=60, ge=0)
    drain_timeout_seconds: int | None = Field(default=None, ge=0)
    tool_timeout_seconds: float = Field(default=10.0, gt=0, allow_inf_nan=False)
    tool_retries: int = Field(default=1, ge=0, le=3)
    tool_filler_delay_seconds: float = Field(default=0.8, ge=0, allow_inf_nan=False)
    knowledge_search_timeout_seconds: float = Field(default=1.5, gt=0)
    knowledge_search_top_k: int = Field(default=4, ge=1, le=10)
    knowledge_min_similarity: float | None = Field(default=None, ge=-1, le=1)
    knowledge_min_keyword_terms: int = Field(default=2, ge=1, le=10)
    call_wrap_up_message: str = (
        "I'm sorry, we've reached the time limit for this call. Thank you for calling, and goodbye."
    )
    idle_check_in_message: str = "Are you still there?"
    after_hours_voicemail_message: str = (
        "Thanks for calling {name}. We're closed right now, but I can take a message for the team."
    )
    after_hours_transfer_message: str = (
        "Thanks for calling {name}. We're closed right now, so I'm transferring you to our "
        "after-hours line."
    )
    after_hours_transfer_failed_message: str = (
        "I'm sorry, I couldn't connect you. I can take a message instead."
    )
