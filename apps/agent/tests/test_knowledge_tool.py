import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager

import asyncpg
import pytest
from answerline_agent import knowledge_tool
from answerline_agent.knowledge import KnowledgeHit, fetch_knowledge_scope
from answerline_agent.knowledge_tool import (
    NO_RESULTS,
    UNAVAILABLE,
    KnowledgeSearch,
    build_search_knowledge_tool,
    format_hits,
    open_knowledge_tools,
)
from answerline_agent.settings import Settings
from livekit.agents import llm
from test_knowledge import add_chunk, axis

DATABASE_URL = os.environ.get("DATABASE_URL")
needs_database = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


def hit(content: str, metadata: dict | None = None) -> KnowledgeHit:
    return KnowledgeHit(
        chunk_id=uuid.uuid4(),
        source_id=uuid.uuid4(),
        content=content,
        metadata=metadata,
        score=1.0,
        vector_rank=1,
        keyword_rank=None,
        similarity=0.9,
        keyword_score=None,
        matched_terms=0,
        query_terms=0,
    )


def test_format_hits_labels_results_with_title_uri_and_page():
    text = format_hits(
        [
            hit("Open nine to five.", {"title": "Hours", "uri": "https://x.test/hours"}),
            hit("Closed Sundays.", {"title": "FAQ", "page": 3}),
            hit("Walk-ins welcome."),
        ]
    )
    assert text == (
        "[1] Hours | https://x.test/hours\nOpen nine to five.\n\n"
        "[2] FAQ | page 3\nClosed Sundays.\n\n"
        "[3] Knowledge base\nWalk-ins welcome."
    )


def test_format_hits_without_hits_says_nothing_found():
    assert format_hits([]) == NO_RESULTS


def test_format_hits_trims_to_budget_on_a_word_boundary():
    text = format_hits([hit("word " * 400, {"title": "Long"})], max_chars=100)
    assert len(text) <= 100
    assert text.endswith("word...")


def test_format_hits_drops_trailing_hits_that_no_longer_fit():
    hits = [hit("a" * 300, {"title": "One"}), hit("b" * 300, {"title": "Two"})]
    text = format_hits(hits, max_chars=400)
    assert len(text) <= 400
    assert "[1] One" in text
    assert "[2]" not in text


def test_format_hits_keeps_a_truncated_second_hit_when_room_remains():
    hits = [hit("a" * 100, {"title": "One"}), hit("b " * 300, {"title": "Two"})]
    text = format_hits(hits, max_chars=450)
    assert len(text) <= 450
    assert "[2] Two" in text
    assert text.endswith("...")


class FakeEmbedder:
    def __init__(self, vectors: dict[str, list[float]] | None = None):
        self.vectors = vectors or {}
        self.queries: list[str] = []

    async def embed(self, texts):
        self.queries.extend(texts)
        return [self.vectors.get(text, axis((0, 1.0))) for text in texts]


class HangingEmbedder:
    async def embed(self, texts):
        await asyncio.sleep(30)


class FailingEmbedder:
    async def embed(self, texts):
        raise RuntimeError("Embedding request failed (HTTP 500)")


class HangingPool:
    def acquire(self):
        return self

    async def __aenter__(self):
        await asyncio.sleep(30)

    async def __aexit__(self, *exc):
        return False


def search_with(embedder, pool=None, timeout: float = 0.2) -> KnowledgeSearch:
    return KnowledgeSearch(
        pool=pool,
        embedder=embedder,
        tenant_id=uuid.uuid4(),
        source_ids=[uuid.uuid4()],
        top_k=4,
        timeout=timeout,
    )


def test_tool_is_a_named_function_tool_with_a_guiding_description():
    tool = build_search_knowledge_tool(search_with(FakeEmbedder()))
    assert isinstance(tool, llm.FunctionTool)
    schema = llm.utils.build_legacy_openai_schema(tool)["function"]
    assert schema["name"] == "search_knowledge"
    assert "opening hours" in schema["description"]
    assert "only from the results" in schema["description"]
    assert list(schema["parameters"]["properties"]) == ["query"]
    assert schema["parameters"]["required"] == ["query"]


def test_blank_query_returns_no_results_without_embedding():
    embedder = FakeEmbedder()
    assert asyncio.run(search_with(embedder).search("   ")) == NO_RESULTS
    assert embedder.queries == []


def test_embedding_timeout_returns_graceful_message(caplog):
    caplog.set_level(logging.WARNING, logger="answerline.agent")

    async def scenario():
        started = asyncio.get_running_loop().time()
        text = await search_with(HangingEmbedder(), timeout=0.1).search("hours")
        return text, asyncio.get_running_loop().time() - started

    text, elapsed = asyncio.run(scenario())
    assert text == UNAVAILABLE
    assert elapsed < 1
    assert "search_knowledge timed out" in caplog.text


def test_search_timeout_returns_graceful_message(caplog):
    caplog.set_level(logging.WARNING, logger="answerline.agent")
    text = asyncio.run(search_with(FakeEmbedder(), HangingPool(), timeout=0.1).search("hours"))
    assert text == UNAVAILABLE
    assert "embed_ms=" in caplog.text


def test_embedding_error_returns_graceful_message(caplog):
    caplog.set_level(logging.WARNING, logger="answerline.agent")
    text = asyncio.run(search_with(FailingEmbedder()).search("hours"))
    assert text == UNAVAILABLE
    assert "search_knowledge failed" in caplog.text


def test_database_error_returns_graceful_message():
    class BrokenPool:
        def acquire(self):
            raise OSError("connection refused")

    assert asyncio.run(search_with(FakeEmbedder(), BrokenPool()).search("hours")) == UNAVAILABLE


@asynccontextmanager
async def tenant_with_agents():
    admin = await asyncpg.connect(DATABASE_URL)
    slug = f"test-{uuid.uuid4()}"
    tenant_id = await admin.fetchval(
        "insert into tenants (slug, name) values ($1, $1) returning id", slug
    )
    agents = {}
    for name in ("alpha", "beta"):
        agents[name] = await admin.fetchval(
            "insert into agents (tenant_id, slug, name, config) values ($1, $2, $2, $3) "
            "returning id",
            tenant_id,
            name,
            json.dumps({}),
        )

    async def source(title: str, *, agent: str | None = None, status: str = "ready") -> uuid.UUID:
        return await admin.fetchval(
            "insert into knowledge_sources (tenant_id, agent_id, type, title, status) "
            "values ($1, $2, 'text', $3, $4) returning id",
            tenant_id,
            agents[agent] if agent else None,
            title,
            status,
        )

    try:
        yield admin, slug, tenant_id, source
    finally:
        await admin.execute("delete from tenants where id = $1", tenant_id)
        await admin.close()


def settings_for(slug: str) -> Settings:
    return Settings(_env_file=None, database_url=DATABASE_URL, tenant=slug)


@needs_database
def test_scope_covers_tenant_wide_and_own_agent_ready_sources_only():
    async def scenario():
        async with tenant_with_agents() as (admin, slug, tenant_id, source):
            shared = await source("shared")
            mine = await source("mine", agent="alpha")
            await source("theirs", agent="beta")
            await source("pending", status="pending")
            await source("failed", agent="alpha", status="failed")
            other_tenant = await admin.fetchval(
                "insert into tenants (slug, name) values ($1, $1) returning id",
                f"test-{uuid.uuid4()}",
            )
            try:
                await admin.execute(
                    "insert into knowledge_sources (tenant_id, type, status) "
                    "values ($1, 'text', 'ready')",
                    other_tenant,
                )
                scope = await fetch_knowledge_scope(admin, tenant_slug=slug, agent_slug="alpha")
                assert scope is not None
                assert scope.tenant_id == tenant_id
                assert set(scope.source_ids) == {shared, mine}
                unknown = await fetch_knowledge_scope(admin, tenant_slug=slug, agent_slug="yaml")
                assert unknown is not None
                assert set(unknown.source_ids) == {shared}
                missing = await fetch_knowledge_scope(admin, tenant_slug="nope", agent_slug="x")
                assert missing is None
            finally:
                await admin.execute("delete from tenants where id = $1", other_tenant)

    asyncio.run(scenario())


@pytest.fixture
def embedding_env(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("EMBEDDING_MODEL", "openai/text-embedding-3-small")


@needs_database
def test_tool_registers_only_when_agent_has_ready_sources(embedding_env):
    async def scenario():
        async with tenant_with_agents() as (_, slug, _, source):
            assert await open_knowledge_tools(settings_for(slug), "alpha") is None
            await source("pending", status="pending")
            assert await open_knowledge_tools(settings_for(slug), "alpha") is None
            await source("theirs", agent="beta")
            assert await open_knowledge_tools(settings_for(slug), "alpha") is None
            beta = await open_knowledge_tools(settings_for(slug), "beta")
            assert beta is not None
            await beta.close()
            await source("shared")
            alpha = await open_knowledge_tools(settings_for(slug), "alpha")
            assert alpha is not None
            assert [t.info.name for t in alpha.tools] == ["search_knowledge"]
            await alpha.close()

    asyncio.run(scenario())


def test_tool_is_not_registered_without_database_url():
    settings = Settings(_env_file=None, database_url=None)
    assert asyncio.run(open_knowledge_tools(settings, "alpha")) is None


@needs_database
def test_tool_is_not_registered_when_tenant_is_unknown(embedding_env):
    settings = Settings(_env_file=None, database_url=DATABASE_URL, tenant="no-such-tenant")
    assert asyncio.run(open_knowledge_tools(settings, "alpha")) is None


@needs_database
def test_tool_is_not_registered_when_embedding_provider_cannot_be_built(monkeypatch, caplog):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("EMBEDDING_MODEL", "openai/text-embedding-3-small")

    async def scenario():
        async with tenant_with_agents() as (_, slug, _, source):
            await source("shared")
            assert await open_knowledge_tools(settings_for(slug), "alpha") is None

    asyncio.run(scenario())
    assert "search_knowledge unavailable" in caplog.text


@needs_database
def test_search_returns_the_scoped_answer_end_to_end(monkeypatch, embedding_env):
    embedder = FakeEmbedder(
        {"when are you open": axis((1, 1.0)), "how much is a cleaning": axis((2, 1.0))}
    )
    monkeypatch.setattr(knowledge_tool, "build_embedder", lambda client: embedder)

    async def scenario():
        async with tenant_with_agents() as (admin, slug, tenant_id, source):
            shared = await source("Hours")
            mine = await source("Prices", agent="alpha")
            theirs = await source("Secret", agent="beta")
            hours_meta = {"title": "Hours", "uri": "https://x.test/hours"}
            await add_chunk(
                admin,
                tenant_id,
                shared,
                0,
                "We are open Monday to Friday, nine to five.",
                axis((1, 1.0)),
                hours_meta,
            )
            await add_chunk(
                admin,
                tenant_id,
                mine,
                0,
                "A cleaning costs one hundred dollars.",
                axis((2, 1.0)),
                {"title": "Prices"},
            )
            await add_chunk(
                admin,
                tenant_id,
                theirs,
                0,
                "Beta only: open on Sundays for cleaning.",
                axis((1, 1.0)),
                {"title": "Secret"},
            )
            tools = await open_knowledge_tools(settings_for(slug), "alpha")
            assert tools is not None
            try:
                tool = tools.tools[0]
                hours = await tool(query="when are you open")
                assert hours.startswith("[1] Hours | https://x.test/hours")
                assert "nine to five" in hours
                assert "Beta only" not in hours
                price = await tool(query="how much is a cleaning")
                assert price.startswith("[1] Prices")
                assert "one hundred dollars" in price
                assert "Beta only" not in price
            finally:
                await tools.close()
            assert embedder.queries == ["when are you open", "how much is a cleaning"]

    asyncio.run(scenario())


@needs_database
def test_relevance_floor_makes_out_of_scope_queries_return_no_results(monkeypatch, embedding_env):
    embedder = FakeEmbedder(
        {"when are you open": axis((1, 1.0)), "do you do botox": axis((7, 1.0))}
    )
    monkeypatch.setattr(knowledge_tool, "build_embedder", lambda client: embedder)
    monkeypatch.setenv("KNOWLEDGE_MIN_SIMILARITY", "0.5")

    async def scenario():
        async with tenant_with_agents() as (admin, slug, tenant_id, source):
            shared = await source("Hours")
            await add_chunk(
                admin,
                tenant_id,
                shared,
                0,
                "We are open Monday to Friday, nine to five.",
                axis((1, 1.0)),
                {"title": "Hours"},
            )
            tools = await open_knowledge_tools(settings_for(slug), "alpha")
            assert tools is not None
            try:
                tool = tools.tools[0]
                assert "nine to five" in await tool(query="when are you open")
                assert await tool(query="do you do botox") == NO_RESULTS
            finally:
                await tools.close()

    asyncio.run(scenario())
