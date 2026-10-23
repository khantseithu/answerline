import asyncio
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from answerline_agent import publisher as publisher_module
from answerline_agent.capture_lead import LeadCaptureContext, build_capture_lead_tool
from answerline_agent.publisher import CallEventPublisher
from answerline_agent.settings import Settings
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
    return build_capture_lead_tool(call, Settings(tool_timeout_seconds=1)), publisher


def test_tool_schema_requires_all_caller_details_and_hides_context():
    capture, _ = tool()
    schema = llm.utils.build_legacy_openai_schema(capture)["function"]
    assert schema["name"] == "capture_lead"
    assert set(schema["parameters"]["required"]) == {"name", "phone", "reason"}
    assert set(schema["parameters"]["properties"]) == {"name", "phone", "reason"}


def test_capture_normalizes_details_and_scopes_stable_identity():
    async def scenario():
        capture, publisher = tool()
        first = await capture(
            FakeContext(), "\ufeff Alex \u0085", " +15555550123 ", " Call back.\n"
        )
        second = await capture(FakeContext(), "Alex", "+15555550123", "Call back.")
        another_call = await capture(FakeContext("tool-2"), "Alex", "+15555550123", "Call back.")
        assert first == second
        assert first["status"] == "queued"
        assert another_call["lead_id"] != first["lead_id"]
        event = publisher.publish_confirmed.call_args_list[0].args[0]
        assert (event.name, event.phone, event.reason) == ("Alex", "+15555550123", "Call back.")
        assert (event.tenant, event.agent, event.room_name) == (
            "default",
            "bright-smile-dental",
            "call-1",
        )
        for tenant, room in (("other", "call-1"), ("default", "call-2")):
            other, _ = tool(tenant=tenant, room_name=room)
            result = await other(FakeContext(), "Alex", "+15555550123", "Call back.")
            assert result["lead_id"] != first["lead_id"]

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "details",
    [
        {"name": "\ufeff\u0085 "},
        {"phone": "\n "},
        {"reason": ""},
        {"name": "x" * 201},
        {"phone": "1" * 101},
        {"reason": "x" * 2001},
    ],
)
def test_invalid_details_do_not_enqueue_or_leak_values(details, caplog):
    capture, publisher = tool()
    supplied = {"name": "Alex", "phone": "+15555550123", "reason": "Call back.", **details}
    with pytest.raises(ToolError) as caught:
        asyncio.run(capture(FakeContext(), **supplied))
    publisher.publish_confirmed.assert_not_called()
    assert "+15555550123" not in str(caught.value)
    assert "+15555550123" not in caplog.text


def test_capture_waits_for_queue_acknowledgement():
    async def scenario():
        accepted = asyncio.Event()
        entered = asyncio.Event()

        async def enqueue(event):
            entered.set()
            await accepted.wait()

        capture, _ = tool(SimpleNamespace(publish_confirmed=enqueue))
        task = asyncio.create_task(capture(FakeContext(), "Alex", "+15555550123", "Call back."))
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
        capture, _ = tool(publisher)
        result = await capture(FakeContext(), "Alex", "+15555550123", "Call back.")
        assert result["status"] == "queued"
        first, second = publisher._queue.jobs
        assert first == second
        assert first[2]["attempts"] == 3
        assert first[2]["backoff"] == {"type": "exponential", "delay": 500}

    asyncio.run(scenario())


def test_capture_failure_does_not_report_success(caplog):
    capture, _ = tool(
        SimpleNamespace(publish_confirmed=AsyncMock(side_effect=RuntimeError("private")))
    )
    with pytest.raises(ToolError) as caught:
        asyncio.run(capture(FakeContext(), "Alex", "+15555550123", "Call back."))
    assert "Do not assume it succeeded" in str(caught.value)
    assert "private" not in str(caught.value)
    assert "private" not in caplog.text
