import asyncio
from typing import Protocol

from livekit import rtc
from livekit.agents import RunContext, llm

from .settings import Settings
from .tool_policy import execute_tool

TRANSFER_TIMEOUT = 15.0
UNAVAILABLE_RESULT = {
    "status": "unavailable",
    "message": (
        "Transfer is not available on this call. Tell the caller you cannot transfer them "
        "and offer to take a voicemail message instead."
    ),
}


class SipTransferClient(Protocol):
    def transfer_sip_participant(
        self, participant: rtc.RemoteParticipant | str, transfer_to: str
    ) -> asyncio.Future: ...


class CallTransfer:
    def __init__(
        self, client: SipTransferClient, to: str, timeout: float = TRANSFER_TIMEOUT
    ) -> None:
        self._client = client
        self._to = to
        self._timeout = timeout
        self._caller: rtc.RemoteParticipant | None = None

    @property
    def timeout(self) -> float:
        return self._timeout

    @property
    def can_transfer(self) -> bool:
        return (
            self._caller is not None
            and self._caller.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
        )

    def set_caller(self, participant: rtc.RemoteParticipant | None) -> None:
        self._caller = participant

    async def transfer(self) -> None:
        if self._caller is None or not self.can_transfer:
            raise RuntimeError("Caller is not a SIP participant")
        async with asyncio.timeout(self._timeout):
            await self._client.transfer_sip_participant(self._caller, self._to)


def build_transfer_call_tool(
    transfer: CallTransfer, settings: Settings | None = None
) -> llm.FunctionTool:
    async def transfer_call(context: RunContext) -> dict[str, str]:
        if not transfer.can_transfer:
            return UNAVAILABLE_RESULT
        await context.wait_for_playout()
        await execute_tool(
            transfer.transfer,
            context=context,
            timeout=transfer.timeout,
            retry_safe=False,
        )
        return {"status": "transferred"}

    return llm.function_tool(
        transfer_call,
        description=(
            "Transfer the caller to a person. Use when the caller asks for a human or a "
            "specific person, in an emergency, or when your instructions say to transfer. "
            "Tell the caller you are transferring them before calling this tool. The transfer "
            "ends your part of the call, so do not call it unless the caller needs a person. "
            "If the result says transfer is unavailable, offer to take a voicemail message "
            "instead."
        ),
    )
