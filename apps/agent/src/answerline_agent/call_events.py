from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

CALL_EVENTS_QUEUE = "call-events"

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")]
NonEmpty = Annotated[str, StringConstraints(min_length=1)]
MAX_SEQ = 2**53 - 1
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


class CallEnded(CallRef):
    type: Literal["call.ended"] = "call.ended"
    status: Literal["completed", "failed"]
    ended_at: Timestamp
    duration_ms: Annotated[int, Field(ge=0)]
    usage: dict[str, float] | None = None
    recording_url: NonEmpty | None = None


CallEventModel = CallStarted | CallTurn | CallEnded
CallEvent = Annotated[CallEventModel, Field(discriminator="type")]

ROLE_MAP: dict[str, Literal["caller", "agent"]] = {"user": "caller", "assistant": "agent"}


def call_event_job_id(event: CallEventModel) -> str:
    if isinstance(event, CallTurn):
        return f"{event.room_name}_{event.type}_{event.seq}"
    return f"{event.room_name}_{event.type}"


def call_event_payload(event: CallEventModel) -> dict:
    return event.model_dump(mode="json", exclude_none=True)


def iso_timestamp(epoch_seconds: float) -> str:
    return datetime.fromtimestamp(epoch_seconds, tz=UTC).isoformat(timespec="milliseconds")


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
