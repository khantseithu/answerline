import asyncio
import logging
from collections.abc import Awaitable
from typing import Any, Protocol

from livekit import rtc
from livekit.agents.voice.events import UserStateChangedEvent

from .settings import Settings

logger = logging.getLogger("answerline.agent")

WRAP_UP_LEAD = 10.0
IDLE_GRACE = 10.0
CHECK_IN_PLAYOUT_WAIT = 10.0
SESSION_CLOSE_WAIT = 5.0
DELETE_ROOM_WAIT = 5.0
DEFAULT_DRAIN_TIMEOUT = 3600
DRAIN_MARGIN = 120
SHUTDOWN_PROCESS_TIMEOUT = 20.0


def wrap_up_lead(max_seconds: int, lead: float = WRAP_UP_LEAD) -> float:
    return min(lead, max_seconds / 2)


def wrap_up_delay(max_seconds: int, lead: float = WRAP_UP_LEAD) -> float | None:
    if max_seconds <= 0:
        return None
    return max_seconds - wrap_up_lead(max_seconds, lead)


def drain_timeout(settings: Settings) -> int:
    if settings.drain_timeout_seconds is not None:
        return settings.drain_timeout_seconds
    if settings.max_call_duration_seconds > 0:
        return settings.max_call_duration_seconds + DRAIN_MARGIN
    return DEFAULT_DRAIN_TIMEOUT


class SpeechHandle(Protocol):
    async def wait_for_playout(self) -> None: ...


class LimitedSession(Protocol):
    def on(self, name: str, handler: Any) -> Any: ...

    def say(self, text: str, *, allow_interruptions: bool = ...) -> SpeechHandle: ...

    def generate_reply(
        self, *, instructions: str, tool_choice: Any = ..., allow_interruptions: bool = ...
    ) -> SpeechHandle: ...

    async def aclose(self) -> None: ...


LOCALIZED_MESSAGE = (
    "Say the following to the caller in the language they are using, keeping the meaning "
    "and adding nothing else: {text}"
)


def speak(session: LimitedSession, text: str, *, localize: bool, **kwargs: Any) -> SpeechHandle:
    if localize:
        return session.generate_reply(
            instructions=LOCALIZED_MESSAGE.format(text=text), tool_choice="none", **kwargs
        )
    return session.say(text, **kwargs)


class CallEvents(Protocol):
    async def flush(self) -> None: ...


class CallJob(Protocol):
    def delete_room(self) -> Awaitable[Any]: ...

    def shutdown(self, reason: str) -> None: ...


class CallLifecycle:
    def __init__(
        self,
        *,
        session: LimitedSession,
        events: CallEvents,
        job: CallJob,
        settings: Settings,
        localize: bool = False,
    ) -> None:
        self._session = session
        self._localize = localize
        self._events = events
        self._job = job
        self._max_seconds = settings.max_call_duration_seconds
        self._idle_enabled = settings.idle_timeout_seconds > 0
        self._wrap_up_message = settings.call_wrap_up_message
        self._check_in_message = settings.idle_check_in_message
        self._ending = False
        self._finish_task: asyncio.Task[None] | None = None
        self._max_task: asyncio.Task[None] | None = None
        self._idle_task: asyncio.Task[None] | None = None
        session.on("close", self._on_close)
        session.on("user_state_changed", self._on_user_state)

    def start(self) -> None:
        delay = wrap_up_delay(self._max_seconds)
        if delay is not None and self._max_task is None and not self._ending:
            self._max_task = asyncio.create_task(self._enforce_max(delay), name="call_max_duration")

    def watch_caller(self, room: rtc.Room, participant: rtc.RemoteParticipant | None) -> None:
        if participant is None:
            return
        identity = participant.identity

        def on_disconnected(left: rtc.RemoteParticipant) -> None:
            if left.identity == identity:
                self.end("caller disconnected")

        room.on("participant_disconnected", on_disconnected)

    def end(self, reason: str) -> None:
        if self._ending:
            return
        self._ending = True
        logger.info("ending call", extra={"reason": reason})
        self._finish_task = asyncio.create_task(self._finish(reason), name="call_finish")

    def _on_close(self, _: object) -> None:
        self.end("session closed")

    def _on_user_state(self, ev: UserStateChangedEvent) -> None:
        if not self._idle_enabled or self._ending:
            return
        if ev.new_state == "away":
            if self._idle_task is None or self._idle_task.done():
                self._idle_task = asyncio.create_task(self._check_in(), name="call_idle_check_in")
        elif self._idle_task is not None:
            self._idle_task.cancel()
            self._idle_task = None

    async def _enforce_max(self, delay: float) -> None:
        await asyncio.sleep(delay)
        lead = wrap_up_lead(self._max_seconds)
        logger.info("call reached max duration, wrapping up", extra={"limit": self._max_seconds})
        await self._say(self._wrap_up_message, lead, allow_interruptions=False)
        self.end("max call duration")

    async def _check_in(self) -> None:
        await self._say(self._check_in_message, CHECK_IN_PLAYOUT_WAIT)
        await asyncio.sleep(IDLE_GRACE)
        logger.info("caller idle, ending call")
        self.end("idle timeout")

    async def _say(self, text: str, timeout: float, **kwargs: Any) -> None:
        try:
            handle = speak(self._session, text, localize=self._localize, **kwargs)
            await asyncio.wait_for(handle.wait_for_playout(), timeout)
        except TimeoutError:
            logger.warning("timed out waiting for the agent to finish speaking")
        except Exception:
            logger.warning("failed to speak before ending the call", exc_info=True)

    async def _finish(self, reason: str) -> None:
        current = asyncio.current_task()
        for task in (self._max_task, self._idle_task):
            if task is not None and task is not current:
                task.cancel()
        await self._bounded(self._session.aclose(), SESSION_CLOSE_WAIT, "close the session")
        await self._events.flush()
        await self._bounded(self._job.delete_room(), DELETE_ROOM_WAIT, "delete the room")
        self._job.shutdown(reason)

    async def _bounded(self, awaitable: Awaitable[Any], timeout: float, action: str) -> None:
        try:
            await asyncio.wait_for(awaitable, timeout)
        except TimeoutError:
            logger.warning("timed out trying to %s", action)
        except Exception:
            logger.warning("failed to %s", action, exc_info=True)
