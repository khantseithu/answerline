import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import nullcontext

import asyncpg
import httpx
from livekit.agents import RunContext, ToolError

logger = logging.getLogger("answerline.agent")

TRANSIENT_ERRORS = (
    ConnectionError,
    TimeoutError,
    httpx.TransportError,
    asyncpg.PostgresConnectionError,
)
FILLER = "One moment, please."
UNAVAILABLE = "That action could not be completed right now. Do not assume it succeeded."


async def retry_transient[T](operation: Callable[[], Awaitable[T]], retries: int) -> T:
    attempt = 0
    while True:
        try:
            return await operation()
        except TRANSIENT_ERRORS:
            if attempt == retries:
                raise
            attempt += 1
            await asyncio.sleep(0.1 * attempt)


async def execute_tool[T](
    operation: Callable[[], Awaitable[T]],
    *,
    context: RunContext | None,
    timeout: float,
    retry_safe: bool = False,
    retries: int = 1,
    filler_delay: float = 0.8,
) -> T:
    filler = context.with_filler(FILLER, delay=filler_delay) if context else nullcontext()
    try:
        async with asyncio.timeout(timeout), filler:
            return await retry_transient(operation, retries if retry_safe else 0)
    except ToolError:
        raise
    except Exception as exc:
        logger.warning("tool execution failed: %s", type(exc).__name__)
        raise ToolError(UNAVAILABLE) from exc
