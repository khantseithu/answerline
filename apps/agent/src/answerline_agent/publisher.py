import asyncio
import logging

from bullmq import Queue
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from .call_events import (
    CALL_EVENTS_QUEUE,
    CallEventModel,
    call_event_job_id,
    call_event_payload,
)

logger = logging.getLogger("answerline.agent")

PUBLISH_TIMEOUT = 5.0
FLUSH_TIMEOUT = 5.0


class CallEventPublisher:
    def __init__(
        self,
        redis_url: str,
        prefix: str,
        *,
        queue_name: str = CALL_EVENTS_QUEUE,
        publish_timeout: float = PUBLISH_TIMEOUT,
    ) -> None:
        self._queue = Queue(queue_name, {"connection": redis_url, "prefix": prefix})
        self._publish_timeout = publish_timeout
        self._pending: set[asyncio.Task[None]] = set()

    def publish(self, event: CallEventModel) -> None:
        task = asyncio.create_task(self._add(event), name="call_event_publish")
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _add(self, event: CallEventModel) -> None:
        job_id = call_event_job_id(event)
        try:
            await asyncio.wait_for(
                self._queue.add(event.type, call_event_payload(event), {"jobId": job_id}),
                self._publish_timeout,
            )
        except Exception:
            logger.warning("failed to publish call event %s", job_id, exc_info=True)

    async def publish_confirmed(self, event: CallEventModel) -> None:
        try:
            await asyncio.wait_for(
                self._queue.add(
                    event.type,
                    call_event_payload(event),
                    {
                        "jobId": call_event_job_id(event),
                        "attempts": 3,
                        "backoff": {"type": "exponential", "delay": 500},
                    },
                ),
                self._publish_timeout,
            )
        except (RedisConnectionError, RedisTimeoutError) as exc:
            raise ConnectionError("Call event queue is temporarily unavailable") from exc

    async def flush(self, timeout: float = FLUSH_TIMEOUT) -> None:
        pending = list(self._pending)
        if not pending:
            return
        _, still_pending = await asyncio.wait(pending, timeout=timeout)
        if still_pending:
            logger.warning("%d call events were not published before shutdown", len(still_pending))
            for task in still_pending:
                task.cancel()

    async def close(self) -> None:
        try:
            await asyncio.wait_for(self._queue.close(), self._publish_timeout)
        except Exception:
            logger.warning("failed to close call event queue", exc_info=True)
