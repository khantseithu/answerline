import {
  type Database,
  EMBEDDING_DIMENSIONS,
  knowledgeChunks,
  knowledgeSources,
} from "@answerline/db";
import { type IngestionJob, ingestionJob, QUEUES } from "@answerline/shared";
import type { Job, Queue } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { chunkKnowledge, knowledgeContentHash } from "./knowledge-chunks.ts";
import { type LoaderOptions, loadKnowledgeSource } from "./knowledge-loaders.ts";

export type EmbedKnowledge = (texts: string[]) => Promise<number[][]>;

const vectorSchema = z
  .array(z.number().finite())
  .length(EMBEDDING_DIMENSIONS)
  .refine((vector) => vector.some((value) => value !== 0), "Embedding must be nonzero");
const sourceFilter = (data: IngestionJob) =>
  and(eq(knowledgeSources.id, data.sourceId), eq(knowledgeSources.tenantId, data.tenantId));

function batches<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size)
  );
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2000) : "Knowledge ingestion failed";
}

export async function ingestKnowledgeSource(
  db: Database,
  data: IngestionJob,
  embed: EmbedKnowledge,
  options: LoaderOptions = {}
) {
  const input = ingestionJob.parse(data);
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.sourceId}, 0))`);
    const [processing] = await db
      .update(knowledgeSources)
      .set({ error: null, status: "processing" })
      .where(sourceFilter(input))
      .returning({ id: knowledgeSources.id });
    if (!processing) {
      throw new Error("Knowledge source not found for tenant");
    }
    const [source] = await tx
      .select()
      .from(knowledgeSources)
      .where(sourceFilter(input))
      .for("update");
    if (!source) {
      throw new Error("Knowledge source was deleted");
    }
    try {
      const documents = await loadKnowledgeSource(source, options);
      const contentHash = knowledgeContentHash(documents);
      if (source.contentHash === contentHash) {
        await tx
          .update(knowledgeSources)
          .set({ error: null, ingestedAt: new Date(), status: "ready" })
          .where(sourceFilter(input));
        return { changed: false };
      }
      const chunks = chunkKnowledge(documents);
      if (!chunks.length) {
        throw new Error("Knowledge source contains no text");
      }
      const vectors = await batches(chunks, 64).reduce(async (pending, batch) => {
        const previous = await pending;
        const result = z
          .array(vectorSchema)
          .length(batch.length)
          .parse(await embed(batch.map((chunk) => chunk.content)));
        return previous.concat(result);
      }, Promise.resolve<number[][]>([]));
      await tx.transaction(async (replacement) => {
        await replacement.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, source.id));
        const rows = chunks.map((chunk, index) => ({
          ...chunk,
          embedding: vectors[index],
          sourceId: source.id,
          tenantId: source.tenantId,
        }));
        await batches(rows, 128).reduce(async (pending, batch) => {
          await pending;
          await replacement.insert(knowledgeChunks).values(batch);
        }, Promise.resolve());
        await replacement
          .update(knowledgeSources)
          .set({ contentHash, error: null, ingestedAt: new Date(), status: "ready" })
          .where(sourceFilter(input));
      });
      return { changed: true };
    } catch (error) {
      await tx
        .update(knowledgeSources)
        .set({ error: failureMessage(error), status: "failed" })
        .where(sourceFilter(input));
      return { error };
    }
  });
  if ("error" in outcome) {
    throw outcome.error;
  }
  return outcome;
}

export function createIngestionProcessor(
  db: Database,
  embed: EmbedKnowledge,
  options: LoaderOptions = {}
) {
  return async (job: Job) => {
    await ingestKnowledgeSource(db, ingestionJob.parse(job.data), embed, options);
  };
}

export async function enqueueIngestion(
  db: Database,
  queue: Queue<IngestionJob>,
  data: IngestionJob
) {
  const input = ingestionJob.parse(data);
  if (queue.name !== QUEUES.ingestion) {
    throw new Error("Ingestion jobs require the ingestion queue");
  }
  const [source] = await db
    .update(knowledgeSources)
    .set({ error: null, status: "pending" })
    .where(sourceFilter(input))
    .returning({ id: knowledgeSources.id });
  if (!source) {
    throw new Error("Knowledge source not found for tenant");
  }
  try {
    return await queue.add("ingest-source", input, {
      attempts: 3,
      backoff: { delay: 1000, type: "exponential" },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  } catch (error) {
    await db
      .update(knowledgeSources)
      .set({ error: failureMessage(error), status: "failed" })
      .where(sourceFilter(input));
    throw error;
  }
}

export const unconfiguredKnowledgeEmbedder: EmbedKnowledge = () => {
  throw new Error(
    "Knowledge embedding provider is not configured; inject a 1536-dimensional EmbedKnowledge function"
  );
};
