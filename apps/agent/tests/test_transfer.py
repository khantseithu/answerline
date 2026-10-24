import asyncio
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from answerline_agent.settings import Settings
from answerline_agent.transfer import CallTransfer, build_transfer_call_tool
from livekit import rtc
from livekit.agents import ToolError, llm

SIP = rtc.ParticipantKind.PARTICIPANT_KIND_SIP
STANDARD = rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD


class FakeContext:
    def __init__(self):
        self.wait_for_playout = AsyncMock()

    def with_filler(self, *args, **kwargs):
        return nullcontext()


def participant(kind, identity="sip_+15555550123"):
    return SimpleNamespace(kind=kind, identity=identity)


def client(side_effect=None):
    async def transfer_sip_participant(participant, transfer_to):
        if side_effect:
            raise side_effect

    return SimpleNamespace(transfer_sip_participant=AsyncMock(side_effect=transfer_sip_participant))


def build(kind, side_effect=None, timeout=1.0):
    fake = client(side_effect)
    transfer = CallTransfer(fake, "+15555550100", timeout)
    if kind is not None:
        transfer.set_caller(participant(kind))
    return build_transfer_call_tool(transfer, Settings(tool_timeout_seconds=1)), transfer, fake


def test_tool_schema_takes_no_arguments():
    transfer_tool, _, _ = build(SIP)
    schema = llm.utils.build_legacy_openai_schema(transfer_tool)["function"]
    assert schema["name"] == "transfer_call"
    assert schema["parameters"]["properties"] == {}
    assert "asks for a human" in schema["description"]


def test_sip_caller_is_transferred_to_target_identity():
    async def scenario():
        transfer_tool, transfer, fake = build(SIP)
        context = FakeContext()
        assert transfer.can_transfer
        assert await transfer_tool(context) == {"status": "transferred"}
        context.wait_for_playout.assert_awaited_once()
        caller, target = fake.transfer_sip_participant.call_args.args
        assert caller.identity == "sip_+15555550123"
        assert target == "tel:+15555550100"

    asyncio.run(scenario())


@pytest.mark.parametrize("kind", [STANDARD, None])
def test_non_sip_caller_gets_unavailable_result_without_transfer(kind):
    async def scenario():
        transfer_tool, transfer, fake = build(kind)
        assert not transfer.can_transfer
        result = await transfer_tool(FakeContext())
        assert result["status"] == "unavailable"
        assert "voicemail" in result["message"]
        fake.transfer_sip_participant.assert_not_called()

    asyncio.run(scenario())


def test_transfer_without_sip_caller_raises():
    _, transfer, fake = build(STANDARD)
    with pytest.raises(RuntimeError):
        asyncio.run(transfer.transfer())
    fake.transfer_sip_participant.assert_not_called()


def test_transfer_failure_surfaces_as_tool_error_without_retry(caplog):
    transfer_tool, _, fake = build(SIP, side_effect=ConnectionError("private"))
    with pytest.raises(ToolError) as caught:
        asyncio.run(transfer_tool(FakeContext()))
    assert "Do not assume it succeeded" in str(caught.value)
    assert "private" not in str(caught.value)
    assert fake.transfer_sip_participant.call_count == 1


def test_transfer_timeout_surfaces_as_tool_error():
    async def never(participant, transfer_to):
        await asyncio.Event().wait()

    fake = SimpleNamespace(transfer_sip_participant=never)
    transfer = CallTransfer(fake, "+15555550100", 0.05)
    transfer.set_caller(participant(SIP))
    transfer_tool = build_transfer_call_tool(transfer)
    with pytest.raises(ToolError):
        asyncio.run(transfer_tool(FakeContext()))


def test_sip_uri_targets_pass_through_unchanged():
    async def scenario():
        fake = client()
        transfer = CallTransfer(fake, "sip:frontdesk@pbx.example.com")
        transfer.set_caller(participant(SIP))
        await transfer.transfer()
        assert fake.transfer_sip_participant.call_args.args[1] == "sip:frontdesk@pbx.example.com"

    asyncio.run(scenario())
