import asyncio
import json
import math
import os
import uuid
from contextlib import asynccontextmanager

import asyncpg
import pytest
from answerline_agent.knowledge import hybrid_search, vector_literal

DATABASE_URL = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")

DIMENSIONS = 1536


def axis(*weights: tuple[int, float]) -> list[float]:
    vector = [0.0] * DIMENSIONS
    for index, weight in weights:
        vector[index] = weight
    norm = math.sqrt(sum(v * v for v in vector))
    return [v / norm for v in vector]


async def create_tenant(conn: asyncpg.Connection) -> uuid.UUID:
    slug = f"test-{uuid.uuid4()}"
    return await conn.fetchval(
        "insert into tenants (slug, name) values ($1, $1) returning id", slug
    )


async def create_source(conn: asyncpg.Connection, tenant_id: uuid.UUID) -> uuid.UUID:
    return await conn.fetchval(
        "insert into knowledge_sources (tenant_id, type, title) values ($1, 'text', 'Hours') "
        "returning id",
        tenant_id,
    )


async def add_chunk(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    source_id: uuid.UUID,
    seq: int,
    content: str,
    embedding: list[float],
    metadata: dict | None = None,
) -> uuid.UUID:
    return await conn.fetchval(
        "insert into knowledge_chunks (tenant_id, source_id, seq, content, metadata, embedding) "
        "values ($1, $2, $3, $4, $5, $6::vector) returning id",
        tenant_id,
        source_id,
        seq,
        content,
        json.dumps(metadata) if metadata is not None else None,
        vector_literal(embedding),
    )


@asynccontextmanager
async def database():
    conn = await asyncpg.connect(DATABASE_URL)
    tenants: list[uuid.UUID] = []

    async def tenant() -> uuid.UUID:
        tenant_id = await create_tenant(conn)
        tenants.append(tenant_id)
        return tenant_id

    try:
        yield conn, tenant
    finally:
        await conn.execute("delete from tenants where id = any($1::uuid[])", tenants)
        await conn.close()


async def seed(conn: asyncpg.Connection, tenant_id: uuid.UUID):
    source_id = await create_source(conn, tenant_id)
    vector_only = await add_chunk(
        conn, tenant_id, source_id, 0, "Parking is free behind the clinic.", axis((0, 1.0))
    )
    both = await add_chunk(
        conn,
        tenant_id,
        source_id,
        1,
        "Opening hours start at nine and close at five.",
        axis((0, 1.0), (1, 1.0)),
        {"title": "Hours", "page": 2, "uri": "file:///faq.pdf"},
    )
    keyword_only = await add_chunk(
        conn, tenant_id, source_id, 2, "Walk-ins are welcome after nine.", axis((5, 1.0))
    )
    return source_id, vector_only, both, keyword_only


def run(coro):
    return asyncio.run(coro)


def test_vector_only_keyword_only_and_fused_winner():
    async def scenario():
        async with database() as (conn, tenant):
            tenant_id = await tenant()
            _, vector_only, both, keyword_only = await seed(conn, tenant_id)
            hits = await hybrid_search(
                conn,
                tenant_id=tenant_id,
                query="nine hours",
                embedding=axis((0, 1.0)),
                candidates=2,
            )
            assert [h.chunk_id for h in hits] == [both, vector_only, keyword_only]
            winner, vec_hit, kw_hit = hits
            assert (winner.vector_rank, winner.keyword_rank) == (2, 1)
            assert (vec_hit.vector_rank, vec_hit.keyword_rank) == (1, None)
            assert (kw_hit.vector_rank, kw_hit.keyword_rank) == (None, 2)
            assert winner.score == pytest.approx(1 / 62 + 1 / 61)
            assert vec_hit.score == pytest.approx(1 / 61)
            assert kw_hit.score == pytest.approx(1 / 62)
            assert winner.metadata == {"title": "Hours", "page": 2, "uri": "file:///faq.pdf"}
            assert vec_hit.metadata is None
            assert winner.content.startswith("Opening hours")

    run(scenario())


def test_natural_language_query_matches_on_any_term():
    async def scenario():
        async with database() as (conn, tenant):
            tenant_id = await tenant()
            _, _, _, keyword_only = await seed(conn, tenant_id)
            hits = await hybrid_search(
                conn,
                tenant_id=tenant_id,
                query="when exactly do walk-ins happen",
                embedding=axis((9, 1.0)),
                candidates=1,
            )
            hit = next(h for h in hits if h.chunk_id == keyword_only)
            assert hit.keyword_rank == 1

    run(scenario())


def test_top_k_limits_results_and_rrf_k_changes_scores():
    async def scenario():
        async with database() as (conn, tenant):
            tenant_id = await tenant()
            _, _, both, _ = await seed(conn, tenant_id)
            hits = await hybrid_search(
                conn,
                tenant_id=tenant_id,
                query="nine hours",
                embedding=axis((0, 1.0)),
                top_k=1,
                candidates=2,
                rrf_k=10,
            )
            assert [h.chunk_id for h in hits] == [both]
            assert hits[0].score == pytest.approx(1 / 12 + 1 / 11)

    run(scenario())


def test_tenant_isolation():
    async def scenario():
        async with database() as (conn, tenant):
            mine = await tenant()
            other = await tenant()
            await seed(conn, mine)
            other_source = await create_source(conn, other)
            foreign = await add_chunk(
                conn, other, other_source, 0, "nine hours nine hours", axis((0, 1.0))
            )
            hits = await hybrid_search(
                conn, tenant_id=mine, query="nine hours", embedding=axis((0, 1.0))
            )
            assert hits
            assert foreign not in [h.chunk_id for h in hits]
            foreign_hits = await hybrid_search(
                conn, tenant_id=other, query="nine hours", embedding=axis((0, 1.0))
            )
            assert [h.chunk_id for h in foreign_hits] == [foreign]

    run(scenario())


def test_source_filter():
    async def scenario():
        async with database() as (conn, tenant):
            tenant_id = await tenant()
            source_a, _, _, _ = await seed(conn, tenant_id)
            source_b = await create_source(conn, tenant_id)
            only_b = await add_chunk(
                conn, tenant_id, source_b, 0, "nine hours nine hours", axis((0, 1.0))
            )
            hits = await hybrid_search(
                conn,
                tenant_id=tenant_id,
                query="nine hours",
                embedding=axis((0, 1.0)),
                source_ids=[source_b],
            )
            assert [h.chunk_id for h in hits] == [only_b]
            hits = await hybrid_search(
                conn,
                tenant_id=tenant_id,
                query="nine hours",
                embedding=axis((0, 1.0)),
                source_ids=[source_a],
            )
            assert only_b not in [h.chunk_id for h in hits]
            assert len(hits) == 3

    run(scenario())


def test_empty_results_and_blank_query():
    async def scenario():
        async with database() as (conn, tenant):
            empty = await tenant()
            assert (
                await hybrid_search(
                    conn, tenant_id=empty, query="nine hours", embedding=axis((0, 1.0))
                )
                == []
            )
            tenant_id = await tenant()
            _, vector_only, _, _ = await seed(conn, tenant_id)
            hits = await hybrid_search(
                conn, tenant_id=tenant_id, query="   ", embedding=axis((0, 1.0)), top_k=1
            )
            assert [h.chunk_id for h in hits] == [vector_only]
            assert hits[0].keyword_rank is None
            stopwords = await hybrid_search(
                conn, tenant_id=tenant_id, query="what is it", embedding=axis((0, 1.0)), top_k=1
            )
            assert stopwords[0].keyword_rank is None

    run(scenario())


def test_rejects_invalid_limits():
    async def scenario():
        async with database() as (conn, _):
            with pytest.raises(ValueError):
                await hybrid_search(
                    conn, tenant_id=uuid.uuid4(), query="x", embedding=axis((0, 1.0)), top_k=0
                )

    run(scenario())
