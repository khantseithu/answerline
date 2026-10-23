import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDb,
  EMBEDDING_DIMENSIONS,
  knowledgeChunks,
  knowledgeSources,
  tenants,
} from "@answerline/db";
import { type IngestionJob, ingestionJob, QUEUES } from "@answerline/shared";
import { Queue, Worker } from "bullmq";
import { asc, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import {
  createIngestionProcessor,
  createKnowledgeEmbedder,
  type EmbedKnowledge,
  enqueueIngestion,
  ingestKnowledgeSource,
} from "./ingestion.ts";

const SEARCH_NINE = /nine/;
const PROVIDER_UNAVAILABLE = /provider unavailable/;
const SOURCE_NOT_FOUND = /not found for tenant/;
const EMBEDDER_NOT_CONFIGURED =
  /Knowledge embedding provider is not configured: Missing API key for embedding provider openai/;

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const queueSkip =
  process.env.DATABASE_URL && process.env.REDIS_URL ? false : "DATABASE_URL or REDIS_URL not set";
const fakeEmbed: EmbedKnowledge = async (texts) =>
  texts.map(() =>
    Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0))
  );

async function withSource(
  run: (db: ReturnType<typeof createDb>, input: IngestionJob) => Promise<void>
) {
  const db = createDb();
  const tenantId = crypto.randomUUID();
  try {
    await db
      .insert(tenants)
      .values({ id: tenantId, name: "Ingestion test", slug: `ingestion-${tenantId}` });
    const [source] = await db
      .insert(knowledgeSources)
      .values({ content: "We open at nine", tenantId, title: "Hours", type: "text" })
      .returning();
    assert.ok(source);
    await run(db, { sourceId: source.id, tenantId });
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.$client.end();
  }
}

async function getSource(db: ReturnType<typeof createDb>, id: string) {
  const [source] = await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, id));
  assert.ok(source);
  return source;
}

function getChunks(db: ReturnType<typeof createDb>, sourceId: string) {
  return db
    .select()
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.sourceId, sourceId))
    .orderBy(asc(knowledgeChunks.seq));
}

test("ingestion validates job boundaries", () => {
  assert.equal(
    ingestionJob.safeParse({ sourceId: "invalid", tenantId: crypto.randomUUID() }).success,
    false
  );
  assert.equal(
    ingestionJob.safeParse({
      content: "unexpected",
      sourceId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
    }).success,
    false
  );
});

test(
  "persists chunks, 1536-dimensional vectors, generated search and observable status",
  { skip },
  () =>
    withSource(async (db, input) => {
      const before = await getSource(db, input.sourceId);
      assert.deepEqual(
        await ingestKnowledgeSource(db, input, async (texts) => {
          assert.equal((await getSource(db, input.sourceId)).status, "processing");
          return fakeEmbed(texts);
        }),
        { changed: true }
      );
      const source = await getSource(db, input.sourceId);
      assert.equal(source.status, "ready");
      assert.equal(source.error, null);
      assert.ok(source.contentHash);
      assert.ok(source.ingestedAt);
      assert.ok(source.updatedAt >= before.updatedAt);
      const [chunk] = await getChunks(db, source.id);
      assert.equal(chunk?.content, "We open at nine");
      assert.equal(chunk?.embedding?.length, EMBEDDING_DIMENSIONS);
      assert.match(chunk?.search ?? "", SEARCH_NINE);
      assert.equal(chunk?.metadata?.title, "Hours");
      assert.equal(chunk?.metadata?.sourceId, source.id);
      assert.equal(chunk?.tenantId, input.tenantId);
    })
);

test("unchanged content skips embeddings; changed content deletes all stale chunks", { skip }, () =>
  withSource(async (db, input) => {
    await db
      .update(knowledgeSources)
      .set({ content: "opening hours ".repeat(400) })
      .where(eq(knowledgeSources.id, input.sourceId));
    await ingestKnowledgeSource(db, input, fakeEmbed);
    const before = await getChunks(db, input.sourceId);
    const firstHash = (await getSource(db, input.sourceId)).contentHash;
    assert.ok(before.length > 1);
    assert.deepEqual(
      await ingestKnowledgeSource(db, input, () => {
        throw new Error("must not embed unchanged content");
      }),
      { changed: false }
    );
    assert.deepEqual(
      (await getChunks(db, input.sourceId)).map((chunk) => chunk.id),
      before.map((chunk) => chunk.id)
    );
    await db
      .update(knowledgeSources)
      .set({ content: "Now open at ten" })
      .where(eq(knowledgeSources.id, input.sourceId));
    await ingestKnowledgeSource(db, input, fakeEmbed);
    const after = await getChunks(db, input.sourceId);
    assert.equal(after.length, 1);
    assert.equal(after[0]?.content, "Now open at ten");
    assert.ok(after.every((chunk) => !before.some((stale) => stale.id === chunk.id)));
    assert.notEqual((await getSource(db, input.sourceId)).contentHash, firstHash);
  })
);

test(
  "failed embedding retains the last good chunks and hash; retry clears the error",
  { skip },
  () =>
    withSource(async (db, input) => {
      await ingestKnowledgeSource(db, input, fakeEmbed);
      const good = await getSource(db, input.sourceId);
      const chunks = await getChunks(db, input.sourceId);
      await db
        .update(knowledgeSources)
        .set({ content: "Updated hours" })
        .where(eq(knowledgeSources.id, input.sourceId));
      await assert.rejects(
        ingestKnowledgeSource(db, input, () => {
          throw new Error("Embedding provider unavailable");
        }),
        PROVIDER_UNAVAILABLE
      );
      const failed = await getSource(db, input.sourceId);
      assert.equal(failed.status, "failed");
      assert.equal(failed.error, "Embedding provider unavailable");
      assert.equal(failed.contentHash, good.contentHash);
      assert.deepEqual(failed.ingestedAt, good.ingestedAt);
      assert.deepEqual(await getChunks(db, input.sourceId), chunks);
      await ingestKnowledgeSource(db, input, fakeEmbed);
      const retried = await getSource(db, input.sourceId);
      assert.equal(retried.status, "ready");
      assert.equal(retried.error, null);
    })
);

test(
  "invalid vectors and loader failures are persisted without replacing good chunks",
  { skip },
  () =>
    withSource(async (db, input) => {
      await ingestKnowledgeSource(db, input, fakeEmbed);
      const chunks = await getChunks(db, input.sourceId);
      await db
        .update(knowledgeSources)
        .set({ content: "Changed" })
        .where(eq(knowledgeSources.id, input.sourceId));
      await [
        [],
        [[1]],
        [Array.from({ length: EMBEDDING_DIMENSIONS }, () => Number.NaN)],
        [Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)],
        [Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1e100)],
      ].reduce(async (pending, invalid) => {
        await pending;
        await assert.rejects(ingestKnowledgeSource(db, input, () => Promise.resolve(invalid)));
        assert.equal((await getSource(db, input.sourceId)).status, "failed");
        assert.deepEqual(await getChunks(db, input.sourceId), chunks);
      }, Promise.resolve());
      await db
        .update(knowledgeSources)
        .set({ content: " " })
        .where(eq(knowledgeSources.id, input.sourceId));
      await assert.rejects(ingestKnowledgeSource(db, input, fakeEmbed));
      assert.equal((await getSource(db, input.sourceId)).status, "failed");
      assert.deepEqual(await getChunks(db, input.sourceId), chunks);
    })
);

test("batches provider requests and inserts for larger sources", { skip }, () =>
  withSource(async (db, input) => {
    await db
      .update(knowledgeSources)
      .set({ content: "opening hours ".repeat(15_000) })
      .where(eq(knowledgeSources.id, input.sourceId));
    const batchSizes: number[] = [];
    await ingestKnowledgeSource(db, input, (texts) => {
      batchSizes.push(texts.length);
      return fakeEmbed(texts);
    });
    const chunks = await getChunks(db, input.sourceId);
    assert.ok(chunks.length > 128);
    assert.ok(batchSizes.length > 2);
    assert.ok(batchSizes.every((size) => size <= 64));
    assert.equal(
      batchSizes.reduce((total, size) => total + size, 0),
      chunks.length
    );
    assert.deepEqual(
      chunks.map((chunk) => chunk.seq),
      Array.from({ length: chunks.length }, (_, index) => index)
    );
  })
);

test("tenant mismatch cannot ingest or modify another tenant's source", { skip }, () =>
  withSource(async (db, input) => {
    await assert.rejects(
      ingestKnowledgeSource(db, { ...input, tenantId: crypto.randomUUID() }, fakeEmbed),
      SOURCE_NOT_FOUND
    );
    assert.equal((await getSource(db, input.sourceId)).status, "pending");
    assert.equal((await getChunks(db, input.sourceId)).length, 0);
  })
);

test("concurrent deliveries serialize replacement and embed unchanged content once", { skip }, () =>
  withSource(async (db, input) => {
    let embeds = 0;
    const embed: EmbedKnowledge = (texts) => {
      embeds += 1;
      return fakeEmbed(texts);
    };
    const results = await Promise.all([
      ingestKnowledgeSource(db, input, embed),
      ingestKnowledgeSource(db, input, embed),
    ]);
    assert.equal(embeds, 1);
    assert.equal(results.filter((result) => result.changed).length, 1);
    assert.equal((await getChunks(db, input.sourceId)).length, 1);
  })
);

test(
  "enqueue helper delivers ingestion through BullMQ to Postgres",
  { skip: queueSkip, timeout: 30_000 },
  () =>
    withSource(async (db, input) => {
      const prefix = `${process.env.REDIS_PREFIX ?? "test"}-ingestion-${crypto.randomUUID()}`;
      const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
      const queue = new Queue<IngestionJob>(QUEUES.ingestion, { connection, prefix });
      const worker = new Worker(QUEUES.ingestion, createIngestionProcessor(db, fakeEmbed), {
        connection,
        prefix,
      });
      try {
        const done = new Promise<void>((resolve, reject) => {
          worker.on("completed", () => resolve());
          worker.on("failed", (_job, error) => reject(error));
          worker.on("error", reject);
        });
        await enqueueIngestion(db, queue, input);
        await done;
        assert.equal((await getSource(db, input.sourceId)).status, "ready");
        assert.equal((await getChunks(db, input.sourceId)).length, 1);
        await assert.rejects(
          enqueueIngestion(db, queue, { ...input, tenantId: crypto.randomUUID() }),
          SOURCE_NOT_FOUND
        );
      } finally {
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
      }
    })
);

test("the env embedder defers a missing API key to an ingestion error", async () => {
  const embed = createKnowledgeEmbedder({});
  await assert.rejects(embed(["hello"]), EMBEDDER_NOT_CONFIGURED);
});

test("the env embedder calls the configured provider", async () => {
  const requests: { body: unknown; url: string }[] = [];
  const embed = createKnowledgeEmbedder(
    { EMBEDDING_MODEL: "ollama/qwen3-embedding:4b", OLLAMA_BASE_URL: "http://ollama.test:11434" },
    (url, init) => {
      requests.push({ body: JSON.parse(String(init?.body)), url: String(url) });
      return Promise.resolve(
        Response.json({
          embeddings: [Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index + 1)],
        })
      );
    }
  );
  const [vector] = await embed(["hello"]);
  assert.equal(requests[0]?.url, "http://ollama.test:11434/api/embed");
  assert.deepEqual(requests[0]?.body, {
    dimensions: EMBEDDING_DIMENSIONS,
    input: ["hello"],
    model: "qwen3-embedding:4b",
    truncate: false,
  });
  assert.equal(vector?.length, EMBEDDING_DIMENSIONS);
  assert.ok(Math.abs(Math.hypot(...(vector ?? [])) - 1) < 1e-9);
});
