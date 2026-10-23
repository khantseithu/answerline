import asyncio
from types import SimpleNamespace

import httpx
import pytest
from answerline_agent.tool_policy import FILLER, execute_tool
from livekit.agents import RunContext, ToolError, llm


def test_transient_read_failure_is_retried():
    calls = []

    async def operation():
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("offline")
        return "found"

    assert asyncio.run(execute_tool(operation, context=None, timeout=1, retry_safe=True)) == "found"
    assert len(calls) == 2


@pytest.mark.parametrize(
    "error", [ConnectionError("offline"), ValueError("invalid"), ToolError("bad")]
)
def test_writes_and_permanent_failures_are_not_retried(error):
    calls = []

    async def operation():
        calls.append(1)
        raise error

    with pytest.raises(ToolError):
        asyncio.run(execute_tool(operation, context=None, timeout=1))
    assert len(calls) == 1


def test_read_programming_error_is_not_retried():
    calls = []

    async def operation():
        calls.append(1)
        raise ValueError("invalid")

    with pytest.raises(ToolError):
        asyncio.run(execute_tool(operation, context=None, timeout=1, retry_safe=True))
    assert len(calls) == 1


def test_retry_exhaustion_is_bounded_and_does_not_expose_error_details(caplog):
    calls = []

    async def operation():
        calls.append(1)
        raise ConnectionError("secret credential")

    with pytest.raises(ToolError) as caught:
        asyncio.run(execute_tool(operation, context=None, timeout=2, retry_safe=True, retries=2))
    assert len(calls) == 3
    assert "secret credential" not in str(caught.value)
    assert "secret credential" not in caplog.text


def test_timeout_cancels_hung_operation():
    cancelled = []

    async def operation():
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    with pytest.raises(ToolError):
        asyncio.run(execute_tool(operation, context=None, timeout=0.02, retry_safe=True))
    assert cancelled == [True]


def test_retry_backoff_is_inside_total_timeout():
    calls = []

    async def operation():
        calls.append(1)
        raise ConnectionError("offline")

    with pytest.raises(ToolError):
        asyncio.run(execute_tool(operation, context=None, timeout=0.02, retry_safe=True, retries=3))
    assert len(calls) == 1


def test_caller_cancellation_propagates_without_retry():
    async def scenario():
        started = asyncio.Event()

        async def operation():
            started.set()
            await asyncio.Event().wait()

        task = asyncio.create_task(
            execute_tool(operation, context=None, timeout=1, retry_safe=True)
        )
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())


class FillerSession:
    def __init__(self):
        self._global_run_state = None
        self.handlers = {}
        self.idle = asyncio.Event()
        self.said = []

    def on(self, name, handler):
        self.handlers[name] = handler

    def off(self, name, handler):
        del self.handlers[name]

    async def wait_for_idle(self):
        await self.idle.wait()

    def say(self, text):
        self.said.append(text)
        return SimpleNamespace()


class FillerSpeech:
    num_steps = 1

    async def wait_if_not_interrupted(self, tasks):
        await asyncio.gather(*tasks)


@pytest.mark.parametrize("slow", [False, True])
def test_real_livekit_filler_only_speaks_for_slow_idle_tools(slow):
    async def scenario():
        session = FillerSession()
        session.idle.set()
        context = RunContext(
            session=session,
            speech_handle=FillerSpeech(),
            function_call=llm.FunctionCall(call_id="tool_1", name="lookup", arguments="{}"),
        )

        async def operation():
            if slow:
                await asyncio.sleep(0.05)
            return "done"

        assert (
            await execute_tool(operation, context=context, timeout=1, filler_delay=0.01) == "done"
        )
        await asyncio.sleep(0.02)
        assert session.said == ([FILLER] if slow else [])
        assert session.handlers == {}

    asyncio.run(scenario())


def test_filler_waits_while_caller_is_speaking_and_is_cleaned_up_on_timeout():
    async def scenario():
        session = FillerSession()
        context = RunContext(
            session=session,
            speech_handle=FillerSpeech(),
            function_call=llm.FunctionCall(call_id="tool_1", name="lookup", arguments="{}"),
        )

        async def operation():
            await asyncio.Event().wait()

        with pytest.raises(ToolError):
            await execute_tool(operation, context=context, timeout=0.03, filler_delay=0.01)
        session.idle.set()
        await asyncio.sleep(0.02)
        assert session.said == []
        assert session.handlers == {}

    asyncio.run(scenario())
