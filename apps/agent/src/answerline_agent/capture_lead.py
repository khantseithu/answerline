import json
import time
from dataclasses import dataclass
from typing import Annotated
from uuid import NAMESPACE_URL, uuid5

from livekit.agents import RunContext, ToolError, llm
from pydantic import Field, ValidationError

from .call_events import LEAD_WHITESPACE, LeadCreated, iso_timestamp
from .publisher import CallEventPublisher
from .settings import Settings
from .tool_policy import execute_tool


@dataclass(frozen=True)
class LeadCaptureContext:
    publisher: CallEventPublisher
    tenant: str
    agent: str
    room_name: str


def build_capture_lead_tool(
    call: LeadCaptureContext, settings: Settings | None = None
) -> llm.FunctionTool:
    settings = settings or Settings()

    async def capture_lead(
        context: RunContext,
        name: Annotated[str, Field(min_length=1, max_length=200, description="The caller's name")],
        phone: Annotated[
            str,
            Field(min_length=1, max_length=100, description="The caller's callback phone number"),
        ],
        reason: Annotated[
            str,
            Field(
                min_length=1,
                max_length=2000,
                description="The caller's reason for requesting follow-up",
            ),
        ],
    ) -> dict[str, str]:
        try:
            event = LeadCreated(
                tenant=call.tenant,
                agent=call.agent,
                room_name=call.room_name,
                lead_id=uuid5(
                    NAMESPACE_URL,
                    json.dumps([call.tenant, call.room_name, context.function_call.call_id]),
                ),
                name=name.strip(LEAD_WHITESPACE),
                phone=phone.strip(LEAD_WHITESPACE),
                reason=reason.strip(LEAD_WHITESPACE),
                created_at=iso_timestamp(time.time()),
            )
        except ValidationError as exc:
            raise ToolError(
                "Provide a valid caller name, callback phone number, and reason."
            ) from exc
        await execute_tool(
            lambda: call.publisher.publish_confirmed(event),
            context=context,
            timeout=settings.tool_timeout_seconds,
            retry_safe=True,
            retries=settings.tool_retries,
            filler_delay=settings.tool_filler_delay_seconds,
        )
        return {"lead_id": str(event.lead_id), "status": "queued"}

    return llm.function_tool(
        capture_lead,
        description=(
            "Capture a caller's name, callback phone number, and reason for follow-up. "
            "Use only details the caller provided and ask for missing details before calling. "
            "Success means the details were accepted for follow-up, not that someone has "
            "already contacted the caller or booked an appointment."
        ),
    )
