import json
import time
from typing import Annotated
from uuid import NAMESPACE_URL, uuid5

from livekit.agents import RunContext, ToolError, llm
from pydantic import Field, ValidationError

from .call_events import LEAD_WHITESPACE, VoicemailCreated, iso_timestamp
from .capture_lead import LeadCaptureContext
from .settings import Settings
from .tool_policy import execute_tool


def clean_optional(value: str | None) -> str | None:
    return (value.strip(LEAD_WHITESPACE) or None) if value else None


def build_voicemail_tool(
    call: LeadCaptureContext, settings: Settings | None = None
) -> llm.FunctionTool:
    settings = settings or Settings()

    async def take_voicemail(
        context: RunContext,
        message: Annotated[
            str,
            Field(
                min_length=1,
                max_length=4000,
                description="The caller's full message, recorded faithfully in their own words",
            ),
        ],
        name: Annotated[
            str | None,
            Field(max_length=200, description="The caller's name, if they gave it"),
        ] = None,
        phone: Annotated[
            str | None,
            Field(max_length=100, description="The caller's callback phone number, if given"),
        ] = None,
    ) -> dict[str, str]:
        try:
            event = VoicemailCreated(
                tenant=call.tenant,
                agent=call.agent,
                room_name=call.room_name,
                voicemail_id=uuid5(
                    NAMESPACE_URL,
                    json.dumps([call.tenant, call.room_name, context.function_call.call_id]),
                ),
                name=clean_optional(name),
                phone=clean_optional(phone),
                message=message.strip(LEAD_WHITESPACE),
                created_at=iso_timestamp(time.time()),
            )
        except ValidationError as exc:
            raise ToolError("Provide a valid voicemail message.") from exc
        await execute_tool(
            lambda: call.publisher.publish_confirmed(event),
            context=context,
            timeout=settings.tool_timeout_seconds,
            retry_safe=True,
            retries=settings.tool_retries,
            filler_delay=settings.tool_filler_delay_seconds,
        )
        return {"voicemail_id": str(event.voicemail_id), "status": "queued"}

    return llm.function_tool(
        take_voicemail,
        description=(
            "Record a voicemail message from the caller for the business to review later. "
            "Let the caller say their full message first, then pass it in their own words "
            "without summarizing; only lightly clean up filler or false starts. "
            "Ask for their name and a callback phone number if they have not given them, "
            "but do not require either: record the message without them if the caller "
            "declines. Success means the message was saved for the team to review, not that "
            "anyone has heard it or will respond at a specific time."
        ),
    )
