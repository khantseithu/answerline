import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

CALL_EVENTS_QUEUE = "call-events"

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")]
NonEmpty = Annotated[str, StringConstraints(min_length=1)]
LEAD_WHITESPACE = (
    "\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f\u0020\u0085\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
LEAD_TEXT_PATTERN = f"[^{LEAD_WHITESPACE}]"
MAX_SEQ = 2**53 - 1
MAX_TOOL_RESULT_CHARS = 8192
TRUNCATION_MARKER = "...[truncated]"
MAX_JSON_ESCAPE_EXPANSION = 6
TIMESTAMP_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"


def _parseable_timestamp(value: str) -> str:
    datetime.fromisoformat(value)
    return value


Timestamp = Annotated[
    str,
    StringConstraints(pattern=TIMESTAMP_PATTERN),
    AfterValidator(_parseable_timestamp),
]


class CallRef(BaseModel):
    agent: Slug
    room_name: NonEmpty
    tenant: Slug


class CallStarted(CallRef):
    type: Literal["call.started"] = "call.started"
    channel: Literal["web", "sip"]
    direction: Literal["inbound", "outbound"] = "inbound"
    from_number: str | None = None
    to_number: str | None = None
    started_at: Timestamp


class TurnLatency(BaseModel):
    llm_ttft_ms: Annotated[float, Field(ge=0)] | None = None
    stt_ms: Annotated[float, Field(ge=0)] | None = None
    tts_ttfb_ms: Annotated[float, Field(ge=0)] | None = None


class CallTurn(CallRef):
    type: Literal["call.turn"] = "call.turn"
    seq: Annotated[int, Field(ge=0, le=MAX_SEQ)]
    role: Literal["caller", "agent"]
    text: str
    started_at: Timestamp
    ended_at: Timestamp | None = None
    interrupted: bool = False
    latency: TurnLatency | None = None


class CallTool(CallRef):
    type: Literal["call.tool"] = "call.tool"
    seq: Annotated[int, Field(ge=0, le=MAX_SEQ)]
    name: NonEmpty
    args: dict[str, Any]
    result: Any = None
    status: Literal["ok", "error", "timeout"]
    error: str | None = None
    latency_ms: Annotated[int, Field(ge=0)]
    started_at: Timestamp


class STTModelUsage(BaseModel):
    stage: Literal["stt"]
    provider: NonEmpty
    model: NonEmpty
    quantity: Annotated[float, Field(ge=0, strict=True, allow_inf_nan=False)]
    unit: Literal["seconds"]


class LLMModelUsage(BaseModel):
    stage: Literal["llm"]
    provider: NonEmpty
    model: NonEmpty
    quantity: Annotated[int, Field(ge=0, le=MAX_SEQ, strict=True)]
    unit: Literal["input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_tokens"]


class TTSModelUsage(BaseModel):
    stage: Literal["tts"]
    provider: NonEmpty
    model: NonEmpty
    quantity: Annotated[int, Field(ge=0, le=MAX_SEQ, strict=True)]
    unit: Literal["characters"]


ModelUsage = Annotated[STTModelUsage | LLMModelUsage | TTSModelUsage, Field(discriminator="stage")]


class CallEnded(CallRef):
    type: Literal["call.ended"] = "call.ended"
    status: Literal["completed", "failed"]
    ended_at: Timestamp
    duration_ms: Annotated[int, Field(ge=0)]
    usage: dict[str, float] | None = None
    model_usage: list[ModelUsage] | None = None
    recording_started_at: Timestamp | None = None
    recording_url: NonEmpty | None = None


class LeadCreated(CallRef):
    type: Literal["lead.created"] = "lead.created"
    lead_id: UUID
    name: Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=LEAD_TEXT_PATTERN)]
    phone: Annotated[
        str, StringConstraints(min_length=1, max_length=100, pattern=LEAD_TEXT_PATTERN)
    ]
    reason: Annotated[
        str,
        StringConstraints(min_length=1, max_length=2000, pattern=LEAD_TEXT_PATTERN),
    ]
    created_at: Timestamp


class VoicemailCreated(CallRef):
    type: Literal["voicemail.created"] = "voicemail.created"
    voicemail_id: UUID
    name: (
        Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=LEAD_TEXT_PATTERN)]
        | None
    ) = None
    phone: (
        Annotated[str, StringConstraints(min_length=1, max_length=100, pattern=LEAD_TEXT_PATTERN)]
        | None
    ) = None
    message: Annotated[
        str,
        StringConstraints(min_length=1, max_length=4000, pattern=LEAD_TEXT_PATTERN),
    ]
    created_at: Timestamp


CallEventModel = CallStarted | CallTurn | CallTool | CallEnded | LeadCreated | VoicemailCreated
CallEvent = Annotated[CallEventModel, Field(discriminator="type")]

ROLE_MAP: dict[str, Literal["caller", "agent"]] = {"user": "caller", "assistant": "agent"}


def call_event_job_id(event: CallEventModel) -> str:
    if isinstance(event, LeadCreated):
        return f"{event.room_name}_{event.type}_{event.lead_id}"
    if isinstance(event, VoicemailCreated):
        return f"{event.room_name}_{event.type}_{event.voicemail_id}"
    if isinstance(event, CallTurn | CallTool):
        return f"{event.room_name}_{event.type}_{event.seq}"
    return f"{event.room_name}_{event.type}"


def call_event_payload(event: CallEventModel) -> dict:
    return event.model_dump(mode="json", exclude_none=True)


def iso_timestamp(epoch_seconds: float) -> str:
    return datetime.fromtimestamp(epoch_seconds, tz=UTC).isoformat(timespec="milliseconds")


def bound_text(text: str, limit: int = MAX_TOOL_RESULT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[: max(limit - len(TRUNCATION_MARKER), 0)] + TRUNCATION_MARKER


def bound_result(value: Any, limit: int = MAX_TOOL_RESULT_CHARS) -> Any:
    if isinstance(value, str):
        return bound_text(value, limit)
    try:
        encoded = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return bound_text(str(value), limit)
    if len(encoded) <= limit:
        return value
    if isinstance(value, dict) and isinstance(value.get("text"), str):
        shrunk = _shrink_text_field(value, limit)
        if shrunk is not None:
            return shrunk
    return bound_text(encoded, limit)


def _shrink_text_field(value: dict, limit: int) -> dict | None:
    text = value["text"]
    budget = len(text)
    while budget > len(TRUNCATION_MARKER):
        candidate = {**value, "text": bound_text(text, budget)}
        excess = len(json.dumps(candidate, ensure_ascii=False)) - limit
        if excess <= 0:
            return candidate
        budget -= max(excess // MAX_JSON_ESCAPE_EXPANSION, 1)
    return None


def parse_tool_args(arguments: str | None) -> dict[str, Any]:
    if not arguments:
        return {}
    try:
        parsed = json.loads(arguments)
    except ValueError:
        return {"raw": bound_text(arguments)}
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def turn_latency(metrics: dict) -> TurnLatency | None:
    sources = {
        "stt_ms": metrics.get("transcription_delay"),
        "llm_ttft_ms": metrics.get("llm_node_ttft"),
        "tts_ttfb_ms": metrics.get("tts_node_ttfb"),
    }
    present = {key: max(value * 1000, 0) for key, value in sources.items() if value is not None}
    return TurnLatency(**present) if present else None


def summarize_usage(model_usage: Iterable) -> dict[str, float] | None:
    totals = {
        "stt_seconds": 0.0,
        "llm_input_tokens": 0.0,
        "llm_output_tokens": 0.0,
        "tts_characters": 0.0,
        "tts_audio_seconds": 0.0,
    }
    seen = False
    for usage in model_usage:
        match usage.type:
            case "stt_usage":
                totals["stt_seconds"] += usage.audio_duration
            case "llm_usage":
                totals["llm_input_tokens"] += usage.input_tokens
                totals["llm_output_tokens"] += usage.output_tokens
            case "tts_usage":
                totals["tts_characters"] += usage.characters_count
                totals["tts_audio_seconds"] += usage.audio_duration
            case _:
                continue
        seen = True
    return totals if seen else None


@dataclass
class CallRecorder:
    room_name: str
    tenant: str
    agent: str
    started_at: float | None = None
    next_seq: int = field(default=0, init=False)
    next_tool_seq: int = field(default=0, init=False)

    def _ref(self) -> dict[str, str]:
        return {"room_name": self.room_name, "tenant": self.tenant, "agent": self.agent}

    def start(
        self,
        *,
        is_sip: bool,
        started_at: float,
        attributes: dict[str, str] | None = None,
    ) -> CallStarted:
        self.started_at = started_at
        attributes = attributes or {}
        return CallStarted(
            **self._ref(),
            channel="sip" if is_sip else "web",
            from_number=attributes.get("sip.phoneNumber") if is_sip else None,
            to_number=attributes.get("sip.trunkPhoneNumber") if is_sip else None,
            started_at=iso_timestamp(started_at),
        )

    def turn(
        self,
        *,
        role: str,
        text: str | None,
        created_at: float,
        interrupted: bool = False,
        metrics: dict | None = None,
    ) -> CallTurn | None:
        mapped = ROLE_MAP.get(role)
        if mapped is None or not text:
            return None
        metrics = metrics or {}
        started = metrics.get("started_speaking_at", created_at)
        stopped = metrics.get("stopped_speaking_at")
        event = CallTurn(
            **self._ref(),
            seq=self.next_seq,
            role=mapped,
            text=text,
            started_at=iso_timestamp(started),
            ended_at=iso_timestamp(stopped) if stopped is not None else None,
            interrupted=interrupted,
            latency=turn_latency(metrics),
        )
        self.next_seq += 1
        return event

    def tool(
        self,
        *,
        name: str,
        arguments: str | None,
        output: Any,
        is_error: bool,
        started_at: float,
        finished_at: float,
        logged: Any = None,
    ) -> CallTool:
        event = CallTool(
            **self._ref(),
            seq=self.next_tool_seq,
            name=name,
            args=parse_tool_args(arguments),
            result=None if is_error else bound_result(output if logged is None else logged),
            status="error" if is_error else "ok",
            error=bound_text(str(output)) if is_error else None,
            latency_ms=max(round((finished_at - started_at) * 1000), 0),
            started_at=iso_timestamp(started_at),
        )
        self.next_tool_seq += 1
        return event

    def end(
        self,
        *,
        ended_at: float,
        failed: bool,
        usage: dict[str, float] | None = None,
        recording_url: str | None = None,
    ) -> CallEnded:
        started = self.started_at if self.started_at is not None else ended_at
        return CallEnded(
            **self._ref(),
            status="failed" if failed else "completed",
            ended_at=iso_timestamp(ended_at),
            duration_ms=max(round((ended_at - started) * 1000), 0),
            usage=usage,
            recording_url=recording_url,
        )
