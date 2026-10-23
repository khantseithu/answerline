import asyncio
import hashlib
import json
import math
import os
import re
import uuid
from collections import defaultdict
from collections.abc import Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import asyncpg
import pytest
from answerline_agent.knowledge import hybrid_search, vector_literal

DATABASE_URL = os.environ.get("DATABASE_URL")
LIVE = os.environ.get("ANSWERLINE_LIVE_EMBEDDINGS") == "1"
LIVE_MIN_SIMILARITY = os.environ.get("ANSWERLINE_MIN_SIMILARITY")

FIXTURES = Path(__file__).parent / "fixtures" / "dental-faq"
DIMENSIONS = 1536
WORKER_MAX_CHARS = 1600
KS = (1, 3, 5)
TOP_K = max(KS)
CHUNK_NAMESPACE = uuid.UUID("5d0c7a64-3f55-4a9e-9d7e-1c1c2f0b8a11")

THRESHOLDS = {
    "offline": {"recall@1": 0.55, "recall@3": 0.75, "recall@5": 0.85, "mrr": 0.65},
    "live": {"recall@1": 0.7, "recall@3": 0.85, "recall@5": 0.9, "mrr": 0.78},
}

OFFLINE_MIN_SIMILARITY = 0.15
OFFLINE_FLOOR_THRESHOLDS = {"recall@1": 0.55, "recall@3": 0.7, "recall@5": 0.7, "mrr": 0.62}
OFFLINE_FLOOR_MIN_EMPTY_OUT_OF_SCOPE = 4

STOPWORDS = frozenset(
    "a about an and any are as at be by can could do does for from get go going guys has have how "
    "i if in is it its just like me my of on or our please so some that the there they this to "
    "up us was we what when where which who will with would you your um uh question answer "
    "something".split()
)


def stem(word: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def features(text: str):
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        if word in STOPWORDS:
            continue
        root = stem(word)
        yield root, 1.0
        padded = f"#{root}#"
        for i in range(len(padded) - 2):
            yield "~" + padded[i : i + 3], 0.4


def hashed_embedding(text: str) -> list[float]:
    vector = [0.0] * DIMENSIONS
    for feature, weight in features(text):
        digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
        number = int.from_bytes(digest, "big")
        vector[number % DIMENSIONS] += weight if (number >> 63) & 1 else -weight
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        vector[0] = 1.0
        return vector
    return [v / norm for v in vector]


async def embed(
    texts: Sequence[str], input_type: Literal["document", "query"]
) -> list[list[float]]:
    if not LIVE:
        return [hashed_embedding(t) for t in texts]
    from answerline_llm.embeddings import EmbeddingSettings

    return await EmbeddingSettings().create_provider(input_type=input_type).embed(list(texts))


@dataclass(frozen=True)
class QueryResult:
    query: str
    kind: str
    expected: list[str]
    ranked: list[str]
    top_vector_rank: int | None
    top_keyword_rank: int | None
    top_score: float
    similarities: list[float | None]

    @property
    def first_rank(self) -> int | None:
        for position, faq_id in enumerate(self.ranked, start=1):
            if faq_id in self.expected:
                return position
        return None

    @property
    def top_similarity(self) -> float | None:
        return self.similarities[0] if self.similarities else None

    @property
    def expected_similarity(self) -> float | None:
        rank = self.first_rank
        return self.similarities[rank - 1] if rank else None


def load_faq() -> list[dict]:
    return json.loads((FIXTURES / "faq.json").read_text())


def load_queries() -> list[dict]:
    return json.loads((FIXTURES / "queries.json").read_text())


def chunk_text(entry: dict) -> str:
    return f"Question: {entry['question']}\nAnswer: {entry['answer']}"


def summarize(results: list[QueryResult]) -> dict[str, float]:
    answerable = [r for r in results if r.expected]
    summary = {
        f"recall@{k}": sum(r.first_rank is not None and r.first_rank <= k for r in answerable)
        / len(answerable)
        for k in KS
    }
    summary["mrr"] = sum(1 / r.first_rank if r.first_rank else 0.0 for r in answerable) / len(
        answerable
    )
    return summary


def median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def similarity_summary(results: list[QueryResult]) -> str:
    answers = [
        r.expected_similarity for r in results if r.expected and r.expected_similarity is not None
    ]
    strays = [r.top_similarity for r in results if not r.expected and r.top_similarity is not None]
    return (
        f"  cosine similarity: in-scope answer hit min={min(answers):.3f} "
        f"median={median(answers):.3f}; out_of_scope top hit median={median(strays):.3f} "
        f"max={max(strays):.3f}"
    )


def format_floor_report(min_similarity: float, results: list[QueryResult]) -> str:
    out_of_scope = [r for r in results if not r.expected]
    empty = sum(not r.ranked for r in out_of_scope)
    summary = summarize(results)
    return (
        f"relevance floor min_similarity={min_similarity}\n"
        + "  "
        + "  ".join(f"{name}={value:.3f}" for name, value in summary.items())
        + f"\n  out_of_scope: {empty} of {len(out_of_scope)} returned no hits"
    )


def format_report(results: list[QueryResult]) -> str:
    mode = "live" if LIVE else "offline"
    lines = [f"retrieval quality ({mode} embeddings)"]
    overall = summarize(results)
    lines.append("overall: " + "  ".join(f"{name}={value:.3f}" for name, value in overall.items()))
    by_kind: dict[str, list[QueryResult]] = defaultdict(list)
    for result in results:
        if result.expected:
            by_kind[result.kind].append(result)
    for kind, group in sorted(by_kind.items()):
        stats = summarize(group)
        lines.append(
            f"  {kind} (n={len(group)}): "
            + "  ".join(f"{name}={value:.3f}" for name, value in stats.items())
        )
    out_of_scope = [r for r in results if not r.expected]
    confident = sum(r.top_vector_rank == 1 and r.top_keyword_rank == 1 for r in out_of_scope)
    lines.append(
        f"  out_of_scope (n={len(out_of_scope)}): top hit ranked first by both vector and "
        f"keyword search for {confident}"
    )
    lines.append(similarity_summary(results))
    lines.append("per query:")
    for r in results:
        if r.expected:
            status = "ok  " if r.first_rank == 1 else "MISS" if r.first_rank is None else "low "
            rank = r.first_rank or "-"
        else:
            status = "oos "
            rank = "-"
        lines.append(
            f"  {status} [{r.kind}] {r.query!r} expected={r.expected} rank={rank} top5={r.ranked}"
        )
    return "\n".join(lines)


@asynccontextmanager
async def seeded_faq():
    faq = load_faq()
    texts = [chunk_text(entry) for entry in faq]
    assert all(len(text) < WORKER_MAX_CHARS for text in texts)
    embeddings = await embed(texts, "document")
    conn = await asyncpg.connect(DATABASE_URL)
    tenant_id = await conn.fetchval(
        "insert into tenants (slug, name) values ($1, $1) returning id", f"test-{uuid.uuid4()}"
    )
    try:
        source_id = await conn.fetchval(
            "insert into knowledge_sources (tenant_id, type, title) "
            "values ($1, 'qa', 'Dental FAQ') returning id",
            tenant_id,
        )
        faq_ids: dict[uuid.UUID, str] = {}
        for seq, (entry, text, embedding) in enumerate(zip(faq, texts, embeddings, strict=True)):
            metadata = {"qaIndex": seq, "question": entry["question"], "type": "qa"}
            chunk_id = await conn.fetchval(
                "insert into knowledge_chunks "
                "(id, tenant_id, source_id, seq, content, metadata, embedding) "
                "values ($1, $2, $3, $4, $5, $6, $7::vector) returning id",
                uuid.uuid5(CHUNK_NAMESPACE, entry["id"]),
                tenant_id,
                source_id,
                seq,
                text,
                json.dumps(metadata),
                vector_literal(embedding),
            )
            faq_ids[chunk_id] = entry["id"]
        yield conn, tenant_id, faq_ids
    finally:
        await conn.execute("delete from tenants where id = $1", tenant_id)
        await conn.close()


async def evaluate(min_similarity: float | None = None) -> list[QueryResult]:
    queries = load_queries()
    query_embeddings = await embed([q["query"] for q in queries], "query")
    results = []
    async with seeded_faq() as (conn, tenant_id, faq_ids):
        for spec, embedding in zip(queries, query_embeddings, strict=True):
            hits = await hybrid_search(
                conn,
                tenant_id=tenant_id,
                query=spec["query"],
                embedding=embedding,
                top_k=TOP_K,
                min_similarity=min_similarity,
            )
            top = hits[0] if hits else None
            results.append(
                QueryResult(
                    query=spec["query"],
                    kind=spec["kind"],
                    expected=spec["expected"],
                    ranked=[faq_ids[h.chunk_id] for h in hits],
                    top_vector_rank=top.vector_rank if top else None,
                    top_keyword_rank=top.keyword_rank if top else None,
                    top_score=top.score if top else 0.0,
                    similarities=[h.similarity for h in hits],
                )
            )
    return results


def test_fixtures_are_consistent():
    faq = load_faq()
    ids = [entry["id"] for entry in faq]
    assert len(ids) == len(set(ids))
    queries = load_queries()
    assert 25 <= len(queries) <= 50
    for spec in queries:
        assert set(spec["expected"]) <= set(ids), spec
        assert (spec["kind"] == "out_of_scope") == (not spec["expected"]), spec
    covered = {faq_id for spec in queries for faq_id in spec["expected"]}
    assert len(covered) >= 20


def test_hashed_embedding_is_deterministic_and_normalized():
    first = hashed_embedding("Do you take insurance?")
    assert first == hashed_embedding("Do you take insurance?")
    assert len(first) == DIMENSIONS
    assert math.isclose(sum(v * v for v in first), 1.0)
    typo = hashed_embedding("do you take insurence")
    unrelated = hashed_embedding("wheelchair ramp entrance")
    dot = sum(a * b for a, b in zip(first, typo, strict=True))
    far = sum(a * b for a, b in zip(first, unrelated, strict=True))
    assert dot > far


@pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")
def test_dental_faq_retrieval_quality():
    results = asyncio.run(evaluate())
    report = format_report(results)
    print("\n" + report)
    thresholds = THRESHOLDS["live" if LIVE else "offline"]
    summary = summarize(results)
    failures = [
        f"{name}: {summary[name]:.3f} < {floor:.3f}"
        for name, floor in thresholds.items()
        if summary[name] < floor
    ]
    assert not failures, "\n".join(failures) + "\n" + report


@pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")
def test_dental_faq_relevance_floor():
    if LIVE and LIVE_MIN_SIMILARITY is None:
        pytest.skip("set ANSWERLINE_MIN_SIMILARITY to evaluate a live relevance floor")
    min_similarity = float(LIVE_MIN_SIMILARITY) if LIVE else OFFLINE_MIN_SIMILARITY
    baseline = asyncio.run(evaluate())
    results = asyncio.run(evaluate(min_similarity))
    print("\n" + format_floor_report(min_similarity, results))
    if LIVE:
        return
    summary = summarize(results)
    failures = [
        f"{name}: {summary[name]:.3f} < {floor:.3f}"
        for name, floor in OFFLINE_FLOOR_THRESHOLDS.items()
        if summary[name] < floor
    ]
    assert not failures, "\n".join(failures)
    assert summary["recall@1"] >= summarize(baseline)["recall@1"]
    empty = sum(not r.ranked for r in results if not r.expected)
    assert empty >= OFFLINE_FLOOR_MIN_EMPTY_OUT_OF_SCOPE
