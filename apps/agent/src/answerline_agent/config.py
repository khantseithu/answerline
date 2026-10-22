from pathlib import Path
from typing import Annotated, Literal

import yaml
from pydantic import AnyUrl, BaseModel, ConfigDict, Field, StringConstraints

ModelRef = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]+/[\w.:-]+$")]
NonEmpty = Annotated[str, StringConstraints(min_length=1)]
TimeRange = Annotated[str, StringConstraints(pattern=r"^\d{2}:\d{2}-\d{2}:\d{2}$")]


class LLMModels(BaseModel):
    primary: ModelRef
    fallback: list[ModelRef] = Field(default_factory=list)


class Models(BaseModel):
    stt: ModelRef
    llm: LLMModels
    tts: ModelRef


class UrlSource(BaseModel):
    type: Literal["url"]
    url: AnyUrl


class FileSource(BaseModel):
    type: Literal["file"]
    path: NonEmpty


class QASource(BaseModel):
    type: Literal["qa"]
    question: str
    answer: str


class Knowledge(BaseModel):
    sources: list[Annotated[UrlSource | FileSource | QASource, Field(discriminator="type")]] = (
        Field(default_factory=list)
    )


class BuiltinTool(BaseModel):
    model_config = ConfigDict(extra="allow")

    builtin: Literal["book_appointment", "transfer_call", "business_hours", "capture_lead"]


class HttpToolSpec(BaseModel):
    name: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$")]
    description: NonEmpty
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    url: NonEmpty
    headers: dict[str, str] | None = None


class HttpTool(BaseModel):
    http: HttpToolSpec


class McpToolSpec(BaseModel):
    name: NonEmpty
    url: AnyUrl


class McpTool(BaseModel):
    mcp: McpToolSpec


class Hours(BaseModel):
    timezone: str
    weekdays: TimeRange
    weekends: TimeRange | None = None
    after_hours: Literal["voicemail", "transfer", "answer"] = "voicemail"


class AgentConfig(BaseModel):
    name: NonEmpty
    greeting: NonEmpty
    language: str = "en"
    instructions: NonEmpty
    models: Models
    knowledge: Knowledge | None = None
    tools: list[BuiltinTool | HttpTool | McpTool] = Field(default_factory=list)
    hours: Hours | None = None


def load_agent_config(path: str | Path) -> AgentConfig:
    return AgentConfig.model_validate(yaml.safe_load(Path(path).read_text()))
