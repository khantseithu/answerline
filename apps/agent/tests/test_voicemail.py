import asyncio
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from answerline_agent import publisher as publisher_module
from answerline_agent.capture_lead import LeadCaptureContext
from answerline_agent.publisher import CallEventPublisher
from answerline_agent.settings import Settings
from answerline_agent.voicemail import build_voicemail_tool
from livekit.agents import ToolError, llm
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError


class FakeContext:
    def __init__(self, call_id="tool-1"):
        self.function_call = SimpleNamespace(call_id=call_id)

    def with_filler(self, *args, **kwargs):
        return nullcontext()


def tool(publisher=None, tenant="default", room_name="call-1"):
    publisher = publisher or SimpleNamespace(publish_confirmed=AsyncMock())
    call = LeadCaptureContext(
        publisher=publisher, tenant=tenant, agent="bright-smile-dental", room_name=room_name
    )
    return build_voicemail_tool(call, Settings(tool_timeout_seconds=1)), publisher


def test_tool_schema_requires_only_the_message_and_hides_context():
    voicemail, _ = tool()
    function = llm.utils.build_legacy_openai_schema(voicemail)["function"]
    assert function["name"] == "take_voicemail"
    assert function["parameters"]["required"] == ["message"]
    assert set(function["parameters"]["properties"]) == {"message", "name", "phone"}
    assert "full message first" in function["description"]


def test_voicemail_normalizes_details_and_scopes_stable_identity():
    async def scenario():
        voicemail, publisher = tool()
        first = await voicemail(
            FakeContext(), "﻿ Please call me back.\n", " Alex \u0085", " +15555550123 "
        )
        second = await voicemail(FakeContext(), "Please call me back.", "Alex", "+15555550123")
        another_call = await voicemail(FakeContext("tool-2"), "Please call me back.")
        assert first == second
        assert first["status"] == "queued"
        assert another_call["voicemail_id"] != first["voicemail_id"]
        event = publisher.publish_confirmed.call_args_list[0].args[0]
        assert (event.message, event.name, event.phone) == (
            "Please call me back.",
            "Alex",
            "+15555550123",
        )
        assert (event.tenant, event.agent, event.room_name) == (
            "default",
            "bright-smile-dental",
            "call-1",
        )
        for tenant, room in (("other", "call-1"), ("default", "call-2")):
            other, _ = tool(tenant=tenant, room_name=room)
            result = await other(FakeContext(), "Please call me back.")
            assert result["voicemail_id"] != first["voicemail_id"]

    asyncio.run(scenario())


@pytest.mark.parametrize("blank", [None, "", "\n ﻿"])
def test_blank_name_and_phone_are_omitted(blank):
    async def scenario():
        voicemail, publisher = tool()
        await voicemail(FakeContext(), "Please call me back.", blank, blank)
        event = publisher.publish_confirmed.call_args.args[0]
        assert (event.name, event.phone) == (None, None)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "details",
    [
        {"message": "﻿\u0085 "},
        {"message": ""},
        {"message": "x" * 4001},
        {"name": "x" * 201},
        {"phone": "1" * 101},
    ],
)
def test_invalid_details_do_not_enqueue_or_leak_values(details, caplog):
    voicemail, publisher = tool()
    supplied = {"message": "Private words.", "name": "Alex", "phone": "+15555550123", **details}
    with pytest.raises(ToolError) as caught:
        asyncio.run(voicemail(FakeContext(), **supplied))
    publisher.publish_confirmed.assert_not_called()
    assert "Private words." not in str(caught.value)
    assert "+15555550123" not in str(caught.value)
    assert "Private words." not in caplog.text
    assert "+15555550123" not in caplog.text


def test_voicemail_waits_for_queue_acknowledgement():
    async def scenario():
        accepted = asyncio.Event()
        entered = asyncio.Event()

        async def enqueue(event):
            entered.set()
            await accepted.wait()

        voicemail, _ = tool(SimpleNamespace(publish_confirmed=enqueue))
        task = asyncio.create_task(voicemail(FakeContext(), "Please call me back."))
        await asyncio.wait_for(entered.wait(), 1)
        assert not task.done()
        accepted.set()
        assert (await task)["status"] == "queued"

    asyncio.run(scenario())


@pytest.mark.parametrize("error", [RedisConnectionError, RedisTimeoutError])
def test_transient_redis_failure_retries_the_same_stable_event(monkeypatch, error):
    class RecoveringQueue:
        def __init__(self, *args):
            self.jobs = []

        async def add(self, name, payload, options):
            self.jobs.append((name, payload, options))
            if len(self.jobs) == 1:
                raise error("unavailable")

    monkeypatch.setattr(publisher_module, "Queue", RecoveringQueue)

    async def scenario():
        publisher = CallEventPublisher("redis://unused", "test")
        voicemail, _ = tool(publisher)
        result = await voicemail(FakeContext(), "Please call me back.")
        assert result["status"] == "queued"
        first, second = publisher._queue.jobs
        assert first == second
        assert first[0] == "voicemail.created"
        assert first[2]["attempts"] == 3
        assert first[2]["backoff"] == {"type": "exponential", "delay": 500}

    asyncio.run(scenario())


def test_voicemail_failure_does_not_report_success(caplog):
    voicemail, _ = tool(
        SimpleNamespace(publish_confirmed=AsyncMock(side_effect=RuntimeError("private")))
    )
    with pytest.raises(ToolError) as caught:
        asyncio.run(voicemail(FakeContext(), "Please call me back."))
    assert "Do not assume it succeeded" in str(caught.value)
    assert "private" not in str(caught.value)
    assert "private" not in caplog.text
