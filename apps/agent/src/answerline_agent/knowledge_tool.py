import asyncio
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Annotated, Any, NamedTuple, Protocol
from uuid import UUID

import asyncpg
import httpx
from livekit.agents import RunContext, llm
from livekit.agents.llm import function_tool
from pydantic import Field

from .knowledge import (
    DEFAULT_MIN_KEYWORD_TERMS,
    KnowledgeHit,
    fetch_knowledge_scope,
    hybrid_search,
)
from .providers import build_embedder
from .settings import Settings
from .tool_log import ToolLog
from .tool_policy import execute_tool, retry_transient

logger = logging.getLogger("answerline.agent")

DB_CONNECT_TIMEOUT = 5.0
POOL_MAX_SIZE = 3
MAX_RESULT_CHARS = 2400
MIN_BLOCK_CHARS = 200
MAX_ERROR_CHARS = 300

TOOL_DESCRIPTION = (
    "Look up facts about the business in its knowledge base: opening hours, services, "
    "prices, policies, location, and similar details. Use it for any factual question "
    "about the business instead of answering from memory. Answer only from the results; "
    "if they do not contain the answer, say you do not have that information."
)
QUERY_DESCRIPTION = "The caller's question, rewritten as a short standalone search query."
NO_RESULTS = "No relevant information was found in the knowledge base."
UNAVAILABLE = "I couldn't look that up right now."


class Embedder(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


def hit_label(hit: KnowledgeHit) -> str:
    metadata = hit.metadata or {}
    parts = [
        value.strip()
        for value in (metadata.get("title"), metadata.get("uri"))
        if isinstance(value, str) and value.strip()
    ]
    page = metadata.get("page")
    if isinstance(page, int):
        parts.append(f"page {page}")
    return " | ".join(parts) or "Knowledge base"


def trim(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[: max(limit - 3, 0)]
    head, _, _ = cut.rpartition(" ")
    return f"{head or cut}..."


def citation(hit: KnowledgeHit) -> dict[str, Any]:
    metadata = hit.metadata or {}
    fields: dict[str, Any] = {
        "source_id": str(hit.source_id),
        "chunk_id": str(hit.chunk_id),
        "title": metadata.get("title"),
        "uri": metadata.get("uri"),
        "page": metadata.get("page"),
        "score": hit.score,
        "similarity": hit.similarity,
    }
    return {key: value for key, value in fields.items() if value is not None}


class FormattedHits(NamedTuple):
    text: str
    used: list[KnowledgeHit]


@dataclass(frozen=True)
class SearchResult:
    text: str
    outcome: str
    hits: list[KnowledgeHit] = field(default_factory=list)
    error: str | None = None

    def log(self) -> dict[str, Any]:
        logged: dict[str, Any] = {
            "text": self.text,
            "outcome": self.outcome,
            "citations": [citation(hit) for hit in self.hits],
        }
        if self.error:
            logged["error"] = self.error
        return logged


def format_hits(hits: Sequence[KnowledgeHit], max_chars: int = MAX_RESULT_CHARS) -> FormattedHits:
    blocks: list[str] = []
    used: list[KnowledgeHit] = []
    remaining = max_chars
    for index, hit in enumerate(hits, 1):
        block = f"[{index}] {hit_label(hit)}\n{hit.content.strip()}"
        if len(block) > remaining:
            if blocks and remaining < MIN_BLOCK_CHARS:
                break
            block = trim(block, remaining)
        blocks.append(block)
        used.append(hit)
        remaining -= len(block) + 2
        if remaining <= 0:
            break
    return FormattedHits("\n\n".join(blocks) if blocks else NO_RESULTS, used)


class KnowledgeSearch:
    def __init__(
        self,
        *,
        pool: asyncpg.Pool,
        embedder: Embedder,
        tenant_id: UUID,
        source_ids: Sequence[UUID],
        top_k: int,
        timeout: float,
        max_chars: int = MAX_RESULT_CHARS,
        min_similarity: float | None = None,
        min_keyword_terms: int = DEFAULT_MIN_KEYWORD_TERMS,
        retries: int = 1,
    ) -> None:
        self._retries = retries
        self._pool = pool
        self._embedder = embedder
        self._tenant_id = tenant_id
        self._source_ids = list(source_ids)
        self._top_k = top_k
        self._timeout = timeout
        self._max_chars = max_chars
        self._min_similarity = min_similarity
        self._min_keyword_terms = min_keyword_terms

    async def search(self, query: str) -> SearchResult:
        query = query.strip()
        if not query:
            return SearchResult(NO_RESULTS, "no_results")
        timings: dict[str, float] = {}
        started = time.perf_counter()
        try:
            async with asyncio.timeout(self._timeout):
                hits = await retry_transient(lambda: self._lookup(query, timings), self._retries)
        except TimeoutError:
            logger.warning(
                "search_knowledge timed out after %.0f ms (%s)",
                (time.perf_counter() - started) * 1000,
                self._format_timings(timings),
            )
            return SearchResult(UNAVAILABLE, "timeout")
        except Exception as exc:
            logger.warning(
                "search_knowledge failed after %.0f ms (%s)",
                (time.perf_counter() - started) * 1000,
                self._format_timings(timings),
                exc_info=True,
            )
            return SearchResult(
                UNAVAILABLE, "error", error=f"{type(exc).__name__}: {exc}"[:MAX_ERROR_CHARS]
            )
        logger.info(
            "search_knowledge %s total_ms=%.0f hits=%d",
            self._format_timings(timings),
            (time.perf_counter() - started) * 1000,
            len(hits),
        )
        text, used = format_hits(hits, self._max_chars)
        return SearchResult(text, "ok" if used else "no_results", used)

    async def _lookup(self, query: str, timings: dict[str, float]) -> list[KnowledgeHit]:
        started = time.perf_counter()
        (embedding,) = await self._embedder.embed([query])
        timings["embed_ms"] = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        async with self._pool.acquire() as conn:
            hits = await hybrid_search(
                conn,
                tenant_id=self._tenant_id,
                query=query,
                embedding=embedding,
                top_k=self._top_k,
                source_ids=self._source_ids,
                min_similarity=self._min_similarity,
                min_keyword_terms=self._min_keyword_terms,
            )
        timings["search_ms"] = (time.perf_counter() - started) * 1000
        return hits

    @staticmethod
    def _format_timings(timings: dict[str, float]) -> str:
        return " ".join(f"{name}={value:.0f}" for name, value in timings.items()) or "no timings"


def build_search_knowledge_tool(
    search: KnowledgeSearch, tool_log: ToolLog, settings: Settings | None = None
) -> llm.FunctionTool:
    settings = settings or Settings()

    async def search_knowledge(
        context: RunContext,
        query: Annotated[str, Field(description=QUERY_DESCRIPTION)],
    ) -> str:
        result = await execute_tool(
            lambda: search.search(query),
            context=context,
            timeout=settings.tool_timeout_seconds,
            filler_delay=settings.tool_filler_delay_seconds,
        )
        tool_log.attach(context.function_call.call_id, result.log())
        return result.text

    return function_tool(search_knowledge, description=TOOL_DESCRIPTION)


@dataclass
class KnowledgeTools:
    tools: list[llm.FunctionTool]
    pool: asyncpg.Pool
    client: httpx.AsyncClient

    async def close(self) -> None:
        await self.client.aclose()
        await self.pool.close()


async def open_knowledge_tools(
    settings: Settings, agent_slug: str, tool_log: ToolLog
) -> KnowledgeTools | None:
    if not settings.database_url:
        return None
    pool: asyncpg.Pool | None = None
    client = httpx.AsyncClient()
    search: KnowledgeSearch | None = None
    source_count = 0
    try:
        pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=1,
            max_size=POOL_MAX_SIZE,
            timeout=DB_CONNECT_TIMEOUT,
        )
        scope = await fetch_knowledge_scope(
            pool, tenant_slug=settings.tenant, agent_slug=agent_slug
        )
        if scope is not None and scope.source_ids:
            source_count = len(scope.source_ids)
            search = KnowledgeSearch(
                pool=pool,
                embedder=build_embedder(client),
                tenant_id=scope.tenant_id,
                source_ids=scope.source_ids,
                top_k=settings.knowledge_search_top_k,
                timeout=settings.knowledge_search_timeout_seconds,
                min_similarity=settings.knowledge_min_similarity,
                min_keyword_terms=settings.knowledge_min_keyword_terms,
                retries=settings.tool_retries,
            )
    except Exception:
        logger.warning("search_knowledge unavailable for agent %s", agent_slug, exc_info=True)
    if search is None or pool is None:
        await client.aclose()
        if pool is not None:
            await pool.close()
        return None
    logger.info("search_knowledge enabled for agent %s (%d sources)", agent_slug, source_count)
    return KnowledgeTools(
        tools=[build_search_knowledge_tool(search, tool_log, settings)], pool=pool, client=client
    )
