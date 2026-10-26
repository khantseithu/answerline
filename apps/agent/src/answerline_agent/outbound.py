import asyncio
import json
import logging

from livekit import api, rtc
from livekit.agents import AgentSession, JobContext

logger = logging.getLogger("answerline.agent")
OUTBOUND_AGENT_READY = json.dumps(
    {
        "answerline": {
            "answering_machine_detection": True,
            "direction": "outbound",
            "outbound_ready": True,
        }
    }
)
OUTBOUND_VOICEMAIL_PLAYOUT_WAIT = 20.0


def outbound_participant_identity(room_name: str) -> str:
    return f"callee-{room_name.removeprefix('call-')}"


def is_outbound_room(room: rtc.Room) -> bool:
    try:
        metadata = json.loads(getattr(room, "metadata", None))
    except (TypeError, json.JSONDecodeError):
        return False
    answerline = metadata.get("answerline") if isinstance(metadata, dict) else None
    return isinstance(answerline, dict) and answerline.get("direction") == "outbound"


def outbound_amd_requested(room: rtc.Room) -> bool:
    try:
        metadata = json.loads(getattr(room, "metadata", None))
    except (TypeError, json.JSONDecodeError):
        return False
    answerline = metadata.get("answerline") if isinstance(metadata, dict) else None
    return (
        isinstance(answerline, dict)
        and answerline.get("direction") == "outbound"
        and answerline.get("answering_machine_detection") is True
    )


async def announce_outbound_ready(ctx: JobContext) -> None:
    await ctx.api.room.update_room_metadata(
        api.UpdateRoomMetadataRequest(room=ctx.room.name, metadata=OUTBOUND_AGENT_READY)
    )


async def hang_up_outbound(ctx: JobContext, caller: rtc.RemoteParticipant) -> None:
    await ctx.api.room.remove_participant(
        api.RoomParticipantIdentity(room=ctx.room.name, identity=caller.identity)
    )


async def leave_outbound_voicemail(
    ctx: JobContext, session: AgentSession, caller: rtc.RemoteParticipant, message: str
) -> None:
    try:
        handle = session.say(message, allow_interruptions=False)
        await asyncio.wait_for(handle.wait_for_playout(), OUTBOUND_VOICEMAIL_PLAYOUT_WAIT)
    except TimeoutError:
        logger.warning("outbound voicemail message did not finish playing")
    except Exception:
        logger.warning("failed to play outbound voicemail message", exc_info=True)
    await hang_up_outbound(ctx, caller)
