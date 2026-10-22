from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field


class LLMModels(BaseModel):
    primary: str
    fallback: list[str] = Field(default_factory=list)


class Models(BaseModel):
    stt: str
    llm: LLMModels
    tts: str


class Hours(BaseModel):
    timezone: str
    weekdays: str
    weekends: str | None = None
    after_hours: Literal["voicemail", "transfer", "answer"] = "voicemail"


class AgentConfig(BaseModel):
    name: str
    greeting: str
    language: str = "en"
    instructions: str
    models: Models
    tools: list[dict] = Field(default_factory=list)
    hours: Hours | None = None


def load_agent_config(path: str | Path) -> AgentConfig:
    return AgentConfig.model_validate(yaml.safe_load(Path(path).read_text()))
