import json
import unicodedata
from collections.abc import Sequence
from typing import Any
from uuid import UUID

import asyncpg
from pydantic import BaseModel, ConfigDict

DEFAULT_TOP_K = 5
DEFAULT_CANDIDATES = 20
DEFAULT_RRF_K = 60
DEFAULT_MIN_KEYWORD_TERMS = 2
DEFAULT_STOPWORD_LANGUAGES = ("english", "spanish")
SUPPORTED_STOPWORD_LANGUAGES = frozenset(
    "arabic basque catalan danish dutch english finnish french german greek hindi hungarian "
    "indonesian irish italian lithuanian nepali norwegian portuguese romanian russian serbian "
    "spanish swedish tamil turkish".split()
)

HYBRID_SEARCH_SQL = """
with q as (
  select
    coalesce(string_agg(term, ' | '), '')::tsquery as query,
    coalesce(array_agg(term), '{}') as terms
  from regexp_split_to_table(plainto_tsquery('simple', $5)::text, ' & ') as term
  where term <> '' and not exists (
    select 1
    from unnest($10::text[]) as lang
    where ts_lexize((lang || '_stem')::regdictionary, trim(both '''' from term)) = '{}'
  )
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
  select id, score, row_number() over (order by score desc, id) as rank
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
    fts.score as keyword_score,
    coalesce(1.0 / ($6 + vec.rank), 0) + coalesce(1.0 / ($6 + fts.rank), 0) as score
  from vec
  full join fts on vec.id = fts.id
),
scored as (
  select
    c.id,
    c.source_id,
    c.content,
    c.metadata,
    fused.score::float8 as score,
    fused.vector_rank,
    fused.keyword_rank,
    (1 - (c.embedding <=> $1::vector))::float8 as similarity,
    fused.keyword_score::float8 as keyword_score,
    (select count(*) from unnest(q.terms) as t where c.search @@ t::tsquery)::int as matched_terms,
    cardinality(q.terms) as query_terms
  from fused
  join knowledge_chunks c on c.id = fused.id
  cross join q
)
select *
from scored
where $8::float8 is null
  or similarity >= $8
  or (matched_terms > 0 and matched_terms >= least($9::int, query_terms))
order by score desc, id
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
    similarity: float | None
    keyword_score: float | None
    matched_terms: int
    query_terms: int


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
    min_similarity: float | None = None,
    min_keyword_terms: int = DEFAULT_MIN_KEYWORD_TERMS,
    stopword_languages: Sequence[str] = DEFAULT_STOPWORD_LANGUAGES,
) -> list[KnowledgeHit]:
    if top_k < 1 or candidates < 1 or rrf_k < 1 or min_keyword_terms < 1:
        raise ValueError("top_k, candidates, rrf_k and min_keyword_terms must be at least 1")
    unsupported = set(stopword_languages) - SUPPORTED_STOPWORD_LANGUAGES
    if unsupported:
        raise ValueError(f"Unsupported stopword languages: {', '.join(sorted(unsupported))}")
    async with conn.transaction():
        await conn.execute("set local hnsw.iterative_scan = strict_order")
        rows = await conn.fetch(
            HYBRID_SEARCH_SQL,
            vector_literal(embedding),
            tenant_id,
            list(source_ids) if source_ids is not None else None,
            candidates,
            unicodedata.normalize("NFC", query),
            rrf_k,
            top_k,
            min_similarity,
            min_keyword_terms,
            list(stopword_languages),
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
            similarity=row["similarity"],
            keyword_score=row["keyword_score"],
            matched_terms=row["matched_terms"],
            query_terms=row["query_terms"],
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
