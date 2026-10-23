import asyncio
import logging
import time
from collections.abc import Callable
from typing import Protocol

from livekit import rtc
from livekit.agents import AgentSession, JobContext
from livekit.agents.voice.events import (
    CloseEvent,
    CloseReason,
    ConversationItemAddedEvent,
    FunctionToolsExecutedEvent,
)

from .call_events import CallEventModel, CallRecorder, summarize_usage

logger = logging.getLogger("answerline.agent")

CLOSE_WAIT = 5.0
PARTICIPANT_WAIT = 30.0


class EventPublisher(Protocol):
    def publish(self, event: CallEventModel) -> None: ...

    async def flush(self) -> None: ...

    async def close(self) -> None: ...


async def wait_for_caller(ctx: JobContext) -> rtc.RemoteParticipant | None:
    try:
        return await asyncio.wait_for(ctx.wait_for_participant(), PARTICIPANT_WAIT)
    except TimeoutError:
        logger.warning("no participant joined within %.0fs", PARTICIPANT_WAIT)
        return None


class CallSessionEvents:
    def __init__(
        self,
        *,
        session: AgentSession,
        publisher: EventPublisher,
        room_name: str,
        tenant: str,
        agent: str,
        recording_url: Callable[[], str | None] | None = None,
    ) -> None:
        self._session = session
        self._publisher = publisher
        self._recorder = CallRecorder(room_name=room_name, tenant=tenant, agent=agent)
        self._recording_url = recording_url
        self._closed = asyncio.Event()
        self._failed = False
        self._started = False
        self._ended = False
        session.on("conversation_item_added", self._on_item)
        session.on("function_tools_executed", self._on_tools)
        session.on("close", self._on_close)

    def started(self, participant: rtc.RemoteParticipant | None) -> None:
        self._started = True
        is_sip = (
            participant is not None and participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
        )
        attributes = dict(participant.attributes) if participant is not None else {}
        try:
            self._publisher.publish(
                self._recorder.start(is_sip=is_sip, started_at=time.time(), attributes=attributes)
            )
        except Exception:
            logger.warning("failed to build call.started event", exc_info=True)

    def _on_item(self, ev: ConversationItemAddedEvent) -> None:
        item = ev.item
        if item.type != "message":
            return
        try:
            event = self._recorder.turn(
                role=item.role,
                text=item.text_content,
                created_at=item.created_at,
                interrupted=item.interrupted,
                metrics=dict(item.metrics),
            )
            if event is not None:
                self._publisher.publish(event)
        except Exception:
            logger.warning("failed to build call.turn event", exc_info=True)

    def _on_tools(self, ev: FunctionToolsExecutedEvent) -> None:
        for call, output in ev.zipped():
            try:
                self._publisher.publish(
                    self._recorder.tool(
                        name=call.name,
                        arguments=call.arguments,
                        output=output.output,
                        is_error=output.is_error,
                        started_at=call.created_at,
                        finished_at=output.created_at,
                    )
                )
            except Exception:
                logger.warning("failed to build call.tool event", exc_info=True)

    def _on_close(self, ev: CloseEvent) -> None:
        self._failed = ev.error is not None or ev.reason == CloseReason.ERROR
        self._closed.set()
        self._publish_ended()

    def _publish_ended(self) -> None:
        if self._ended or not self._started:
            return
        self._ended = True
        try:
            try:
                usage = summarize_usage(self._session.usage.model_usage)
            except Exception:
                logger.warning("failed to read session usage", exc_info=True)
                usage = None
            self._publisher.publish(
                self._recorder.end(
                    ended_at=time.time(),
                    failed=self._failed,
                    usage=usage,
                    recording_url=self._recording_url() if self._recording_url else None,
                )
            )
        except Exception:
            logger.warning("failed to build call.ended event", exc_info=True)

    async def on_shutdown(self, reason: str) -> None:
        try:
            await asyncio.wait_for(self._closed.wait(), CLOSE_WAIT)
        except TimeoutError:
            logger.warning("session did not close before shutdown")
        try:
            await self.flush()
        finally:
            await self._publisher.close()

    async def flush(self) -> None:
        try:
            self._publish_ended()
            await self._publisher.flush()
        except Exception:
            logger.warning("failed to flush call events", exc_info=True)
