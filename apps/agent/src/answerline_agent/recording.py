import asyncio
import logging

from livekit import api
from livekit.agents import AgentSession, JobContext
from livekit.api import egress_service
from pydantic_settings import BaseSettings, SettingsConfigDict

from .config import AgentConfig

logger = logging.getLogger("answerline.agent")

START_TIMEOUT = 5.0
STOP_TIMEOUT = 5.0


class RecordingSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    s3_bucket: str = "recordings"


def recording_key(tenant: str, room_name: str) -> str:
    return f"{tenant}/{room_name}.ogg"


class CallRecording:
    def __init__(
        self,
        egress: egress_service.EgressService,
        *,
        room_name: str,
        tenant: str,
        bucket: str,
    ) -> None:
        self._egress = egress
        self._room_name = room_name
        self._key = recording_key(tenant, room_name)
        self._bucket = bucket
        self._egress_id: str | None = None

    @property
    def url(self) -> str | None:
        if self._egress_id is None:
            return None
        return f"s3://{self._bucket}/{self._key}"

    async def start(self) -> bool:
        request = api.RoomCompositeEgressRequest(
            room_name=self._room_name,
            audio_only=True,
            file_outputs=[
                api.EncodedFileOutput(
                    file_type=api.EncodedFileType.OGG,
                    filepath=self._key,
                    disable_manifest=True,
                )
            ],
        )
        try:
            info = await asyncio.wait_for(
                self._egress.start_room_composite_egress(request), START_TIMEOUT
            )
        except Exception:
            logger.warning("failed to start recording for %s", self._room_name, exc_info=True)
            return False
        self._egress_id = info.egress_id
        logger.info("recording %s started as egress %s", self.url, info.egress_id)
        return True

    async def stop(self) -> None:
        if self._egress_id is None:
            return
        try:
            await asyncio.wait_for(
                self._egress.stop_egress(api.StopEgressRequest(egress_id=self._egress_id)),
                STOP_TIMEOUT,
            )
        except Exception:
            logger.warning("failed to stop recording %s", self._egress_id, exc_info=True)


def build_call_recording(
    ctx: JobContext, config: AgentConfig, tenant: str, settings: RecordingSettings | None = None
) -> CallRecording | None:
    if not config.recording.enabled:
        return None
    settings = settings or RecordingSettings()
    return CallRecording(
        ctx.api.egress, room_name=ctx.room.name, tenant=tenant, bucket=settings.s3_bucket
    )


async def start_with_notice(recording: CallRecording, session: AgentSession, notice: str) -> None:
    if await recording.start():
        await session.say(notice)
