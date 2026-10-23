import json
from collections.abc import Sequence
from typing import Any
from uuid import UUID

import asyncpg
from pydantic import BaseModel, ConfigDict

DEFAULT_TOP_K = 5
DEFAULT_CANDIDATES = 20
DEFAULT_RRF_K = 60

HYBRID_SEARCH_SQL = """
with q as (
  select coalesce(string_agg(term, ' | '), '')::tsquery as query
  from regexp_split_to_table(plainto_tsquery('simple', $5)::text, ' & ') as term
  where term <> '' and ts_lexize('english_stem', trim(both '''' from term)) is distinct from '{}'
),
vec as (
  select id, row_number() over (order by embedding <=> $1::vector, id) as rank
  from (
    select id, embedding
    from knowledge_chunks
    where tenant_id = $2
      and embedding is not null
      and ($3::uuid[] is null or source_id = any($3::uuid[]))
    order by embedding <=> $1::vector
    limit $4
  ) nearest
),
fts as (
  select id, row_number() over (order by score desc, id) as rank
  from (
    select c.id, ts_rank_cd(c.search, q.query) as score
    from knowledge_chunks c, q
    where c.tenant_id = $2
      and c.search @@ q.query
      and ($3::uuid[] is null or c.source_id = any($3::uuid[]))
    order by score desc, c.id
    limit $4
  ) matched
),
fused as (
  select
    coalesce(vec.id, fts.id) as id,
    vec.rank as vector_rank,
    fts.rank as keyword_rank,
    coalesce(1.0 / ($6 + vec.rank), 0) + coalesce(1.0 / ($6 + fts.rank), 0) as score
  from vec
  full join fts on vec.id = fts.id
)
select
  c.id,
  c.source_id,
  c.content,
  c.metadata,
  fused.score::float8 as score,
  fused.vector_rank,
  fused.keyword_rank
from fused
join knowledge_chunks c on c.id = fused.id
order by fused.score desc, c.id
limit $7
"""


class KnowledgeHit(BaseModel):
    model_config = ConfigDict(frozen=True)

    chunk_id: UUID
    source_id: UUID
    content: str
    metadata: dict[str, Any] | None
    score: float
    vector_rank: int | None
    keyword_rank: int | None


def vector_literal(embedding: Sequence[float]) -> str:
    return "[" + ",".join(repr(float(v)) for v in embedding) + "]"


async def hybrid_search(
    conn: asyncpg.Connection,
    *,
    tenant_id: UUID,
    query: str,
    embedding: Sequence[float],
    top_k: int = DEFAULT_TOP_K,
    candidates: int = DEFAULT_CANDIDATES,
    rrf_k: int = DEFAULT_RRF_K,
    source_ids: Sequence[UUID] | None = None,
) -> list[KnowledgeHit]:
    if top_k < 1 or candidates < 1 or rrf_k < 1:
        raise ValueError("top_k, candidates and rrf_k must be at least 1")
    async with conn.transaction():
        await conn.execute("set local hnsw.iterative_scan = strict_order")
        rows = await conn.fetch(
            HYBRID_SEARCH_SQL,
            vector_literal(embedding),
            tenant_id,
            list(source_ids) if source_ids is not None else None,
            candidates,
            query,
            rrf_k,
            top_k,
        )
    return [
        KnowledgeHit(
            chunk_id=row["id"],
            source_id=row["source_id"],
            content=row["content"],
            metadata=json.loads(row["metadata"]) if row["metadata"] is not None else None,
            score=row["score"],
            vector_rank=row["vector_rank"],
            keyword_rank=row["keyword_rank"],
        )
        for row in rows
    ]


KNOWLEDGE_SCOPE_SQL = """
select
  t.id as tenant_id,
  coalesce(array_agg(s.id order by s.id) filter (where s.id is not null), '{}') as source_ids
from tenants t
left join agents a on a.tenant_id = t.id and a.slug = $2
left join knowledge_sources s
  on s.tenant_id = t.id
  and s.status = 'ready'
  and (s.agent_id is null or s.agent_id = a.id)
where t.slug = $1
group by t.id
"""


class KnowledgeScope(BaseModel):
    model_config = ConfigDict(frozen=True)

    tenant_id: UUID
    source_ids: tuple[UUID, ...]


async def fetch_knowledge_scope(
    conn: asyncpg.Connection | asyncpg.Pool, *, tenant_slug: str, agent_slug: str
) -> KnowledgeScope | None:
    row = await conn.fetchrow(KNOWLEDGE_SCOPE_SQL, tenant_slug, agent_slug)
    if row is None:
        return None
    return KnowledgeScope(tenant_id=row["tenant_id"], source_ids=tuple(row["source_ids"]))
