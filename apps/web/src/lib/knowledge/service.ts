import { type Database, knowledgeSources } from "@answerline/db";
import type { IngestionJob } from "@answerline/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { removeKnowledgeFile, saveKnowledgeFile } from "./files";
import type { CreateKnowledgeSource } from "./schemas";
import type { KnowledgeSourceView } from "./types";

export class KnowledgeNotFoundError extends Error {
  constructor() {
    super("Knowledge source not found");
  }
}

export class KnowledgeQueueError extends Error {}

export interface KnowledgeDeps {
  db: Database;
  enqueue: (data: IngestionJob) => Promise<unknown>;
  filesDir: string;
  tenantId: string;
}

const itemCount = sql<number | null>`case
  when ${knowledgeSources.type} = 'qa' then jsonb_array_length(${knowledgeSources.content})
  when ${knowledgeSources.type} = 'text' then char_length(${knowledgeSources.content} #>> '{}')
end`.mapWith(Number);

const forTenant = (deps: KnowledgeDeps, id: string) =>
  and(eq(knowledgeSources.id, id), eq(knowledgeSources.tenantId, deps.tenantId));

export async function listKnowledgeSources(deps: KnowledgeDeps): Promise<KnowledgeSourceView[]> {
  const rows = await deps.db
    .select({
      createdAt: knowledgeSources.createdAt,
      error: knowledgeSources.error,
      id: knowledgeSources.id,
      ingestedAt: knowledgeSources.ingestedAt,
      itemCount,
      status: knowledgeSources.status,
      title: knowledgeSources.title,
      type: knowledgeSources.type,
      uri: knowledgeSources.uri,
    })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.tenantId, deps.tenantId))
    .orderBy(desc(knowledgeSources.createdAt), desc(knowledgeSources.id));
  return rows.map((row) => ({
    createdAt: row.createdAt.toISOString(),
    error: row.error,
    id: row.id,
    ingestedAt: row.ingestedAt?.toISOString() ?? null,
    itemCount: row.type === "qa" || row.type === "text" ? row.itemCount : null,
    status: row.status,
    title: row.title,
    type: row.type,
    uri: row.type === "url" ? row.uri : null,
  }));
}

async function queue(deps: KnowledgeDeps, sourceId: string) {
  try {
    await deps.enqueue({ sourceId, tenantId: deps.tenantId });
  } catch (error) {
    throw new KnowledgeQueueError("Could not queue ingestion", { cause: error });
  }
}

export async function createKnowledgeSource(deps: KnowledgeDeps, input: CreateKnowledgeSource) {
  const values = (() => {
    switch (input.type) {
      case "url":
        return { title: input.title ?? null, type: "url" as const, uri: input.url };
      case "text":
        return { content: input.content, title: input.title, type: "text" as const };
      case "qa":
        return { content: input.pairs, title: input.title, type: "qa" as const };
      default:
        throw new Error("Unsupported knowledge source type");
    }
  })();
  const [source] = await deps.db
    .insert(knowledgeSources)
    .values({ ...values, status: "pending", tenantId: deps.tenantId })
    .returning({ id: knowledgeSources.id });
  if (!source) {
    throw new Error("Knowledge source was not created");
  }
  await queue(deps, source.id);
  return source.id;
}

export async function createKnowledgeFileSource(
  deps: KnowledgeDeps,
  file: { data: Uint8Array; name: string }
) {
  const path = await saveKnowledgeFile(deps.filesDir, deps.tenantId, file);
  try {
    const [source] = await deps.db
      .insert(knowledgeSources)
      .values({
        status: "pending",
        tenantId: deps.tenantId,
        title: file.name.slice(0, 200),
        type: "file",
        uri: path,
      })
      .returning({ id: knowledgeSources.id });
    if (!source) {
      throw new Error("Knowledge source was not created");
    }
    await queue(deps, source.id);
    return source.id;
  } catch (error) {
    if (!(error instanceof KnowledgeQueueError)) {
      await removeKnowledgeFile(deps.filesDir, deps.tenantId, path);
    }
    throw error;
  }
}

export async function resyncKnowledgeSource(deps: KnowledgeDeps, id: string) {
  const [source] = await deps.db
    .select({ id: knowledgeSources.id })
    .from(knowledgeSources)
    .where(forTenant(deps, id));
  if (!source) {
    throw new KnowledgeNotFoundError();
  }
  await queue(deps, source.id);
}

export async function deleteKnowledgeSource(deps: KnowledgeDeps, id: string) {
  const [source] = await deps.db
    .delete(knowledgeSources)
    .where(forTenant(deps, id))
    .returning({ type: knowledgeSources.type, uri: knowledgeSources.uri });
  if (!source) {
    throw new KnowledgeNotFoundError();
  }
  if (source.type === "file") {
    await removeKnowledgeFile(deps.filesDir, deps.tenantId, source.uri);
  }
}
