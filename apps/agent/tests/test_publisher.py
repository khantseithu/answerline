import asyncio
import json
import os
import uuid
from pathlib import Path

import pytest
import redis.asyncio as aioredis
from answerline_agent import publisher as publisher_module
from answerline_agent.call_events import (
    CALL_EVENTS_QUEUE,
    CallEvent,
    call_event_job_id,
    call_event_payload,
)
from answerline_agent.publisher import CallEventPublisher
from pydantic import TypeAdapter

REDIS_URL = os.environ.get("REDIS_URL")
VALID = Path(__file__).resolve().parents[3] / "packages/shared/fixtures/call-event/valid"
ADAPTER = TypeAdapter(CallEvent)


def _fixture_events() -> list[tuple[dict, object]]:
    raw = [json.loads(path.read_text()) for path in sorted(VALID.glob("*.json"))]
    for index, data in enumerate(raw):
        data["room_name"] = f"{data['room_name']}-{index}"
    return [(data, ADAPTER.validate_python(data)) for data in raw]


@pytest.mark.skipif(not REDIS_URL, reason="REDIS_URL not set")
def test_publishes_fixtures_to_call_events_queue():
    prefix = f"test-{uuid.uuid4()}"

    async def run() -> None:
        publisher = CallEventPublisher(REDIS_URL, prefix)
        client = aioredis.from_url(REDIS_URL, decode_responses=True)
        try:
            events = _fixture_events()
            for _, event in events:
                publisher.publish(event)
            await publisher.flush()
            for data, event in events:
                job_id = call_event_job_id(event)
                job = await client.hgetall(f"{prefix}:{CALL_EVENTS_QUEUE}:{job_id}")
                assert job["name"] == data["type"]
                assert json.loads(job["data"]) == call_event_payload(event)
                assert job["data"] and json.loads(job["data"])["room_name"] == data["room_name"]
            waiting = await client.lrange(f"{prefix}:{CALL_EVENTS_QUEUE}:wait", 0, -1)
            assert sorted(waiting) == sorted(call_event_job_id(event) for _, event in events)
        finally:
            await publisher.close()
            keys = [key async for key in client.scan_iter(match=f"{prefix}:*")]
            if keys:
                await client.delete(*keys)
            await client.aclose()

    asyncio.run(run())


@pytest.mark.skipif(not REDIS_URL, reason="REDIS_URL not set")
def test_republishing_same_event_is_idempotent():
    prefix = f"test-{uuid.uuid4()}"

    async def run() -> None:
        publisher = CallEventPublisher(REDIS_URL, prefix)
        client = aioredis.from_url(REDIS_URL, decode_responses=True)
        try:
            _, event = _fixture_events()[0]
            publisher.publish(event)
            publisher.publish(event)
            await publisher.flush()
            waiting = await client.lrange(f"{prefix}:{CALL_EVENTS_QUEUE}:wait", 0, -1)
            assert waiting == [call_event_job_id(event)]
        finally:
            await publisher.close()
            keys = [key async for key in client.scan_iter(match=f"{prefix}:*")]
            if keys:
                await client.delete(*keys)
            await client.aclose()

    asyncio.run(run())


def test_unreachable_redis_does_not_raise():
    async def run() -> None:
        publisher = CallEventPublisher("redis://127.0.0.1:1", "bull", publish_timeout=0.3)
        _, event = _fixture_events()[0]
        publisher.publish(event)
        await publisher.flush(timeout=2)
        await publisher.close()

    asyncio.run(run())


def test_queue_errors_are_logged_not_raised(monkeypatch, caplog):
    class BrokenQueue:
        def __init__(self, *args, **kwargs):
            pass

        async def add(self, *args, **kwargs):
            raise RuntimeError("boom")

        async def close(self):
            raise RuntimeError("boom")

    monkeypatch.setattr(publisher_module, "Queue", BrokenQueue)

    async def run() -> None:
        publisher = CallEventPublisher("redis://unused", "bull")
        _, event = _fixture_events()[0]
        publisher.publish(event)
        await publisher.flush()
        await publisher.close()

    with caplog.at_level("WARNING", logger="answerline.agent"):
        asyncio.run(run())
    assert "failed to publish call event" in caplog.text


def test_flush_is_bounded_when_publish_hangs(monkeypatch):
    class HangingQueue:
        def __init__(self, *args, **kwargs):
            pass

        async def add(self, *args, **kwargs):
            await asyncio.sleep(60)

        async def close(self):
            pass

    monkeypatch.setattr(publisher_module, "Queue", HangingQueue)

    async def run() -> float:
        publisher = CallEventPublisher("redis://unused", "bull", publish_timeout=60)
        _, event = _fixture_events()[0]
        publisher.publish(event)
        loop = asyncio.get_running_loop()
        started = loop.time()
        await publisher.flush(timeout=0.2)
        return loop.time() - started

    assert asyncio.run(run()) < 2
