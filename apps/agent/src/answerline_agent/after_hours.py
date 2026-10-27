import asyncio
import logging
from typing import Literal, Protocol

from .business_hours import Schedule
from .call_limits import LimitedSession, SpeechHandle, speak
from .config import Hours
from .settings import Settings

logger = logging.getLogger("answerline.agent")

PLAYOUT_WAIT = 15.0


class Transfer(Protocol):
    @property
    def can_transfer(self) -> bool: ...

    async def transfer(self) -> None: ...


class AfterHours:
    def __init__(
        self, hours: Hours | None, name: str, settings: Settings, *, localize: bool = False
    ) -> None:
        self._name = name
        self._settings = settings
        self._localize = localize
        self.mode: Literal["voicemail", "transfer", "answer"] | None = None
        self.holiday: str | None = None
        if hours is None:
            return
        schedule = Schedule.from_hours(hours)
        local = schedule.now()
        if schedule.is_open_at(local):
            return
        self.mode = hours.after_hours
        holiday = schedule.holiday(local.date())
        if holiday:
            self.holiday = holiday.name or "a holiday"

    @property
    def takes_voicemail(self) -> bool:
        return self.mode in ("voicemail", "transfer")

    def instructions(self) -> str | None:
        if self.mode is None:
            return None
        closed = "The business is closed right now"
        if self.holiday:
            closed += f" for {self.holiday}"
        if self.mode == "answer":
            return (
                f"{closed}. Help the caller as usual, but make clear that nobody is available "
                "in person until the business reopens."
            )
        return (
            f"{closed}. Tell the caller, offer to take a message, and record it with the "
            "take_voicemail tool. You may still answer brief questions."
        )

    def _say(self, session: LimitedSession, text: str) -> SpeechHandle:
        return speak(session, text, localize=self._localize)

    def _message(self, template: str) -> str:
        return template.replace("{name}", self._name)

    async def greet(
        self, session: LimitedSession, greeting: str, transfer: Transfer | None
    ) -> None:
        if self.mode is None or self.mode == "answer":
            session.say(greeting)
            return
        if self.mode == "transfer" and transfer is not None and transfer.can_transfer:
            handle = self._say(session, self._message(self._settings.after_hours_transfer_message))
            try:
                await asyncio.wait_for(handle.wait_for_playout(), PLAYOUT_WAIT)
            except TimeoutError:
                logger.warning("after-hours transfer notice did not finish playing")
            try:
                await transfer.transfer()
                return
            except Exception:
                logger.warning("after-hours transfer failed", exc_info=True)
                self._say(session, self._settings.after_hours_transfer_failed_message)
                return
        self._say(session, self._message(self._settings.after_hours_voicemail_message))
