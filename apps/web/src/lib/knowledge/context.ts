import { createDb, type Database, tenants } from "@answerline/db";
import { type IngestionJob, QUEUES } from "@answerline/shared";
import { enqueueIngestion } from "@answerline/worker/ingestion";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { env } from "@/env";
import type { KnowledgeDeps } from "./service";

interface KnowledgeRuntime {
  db: Database;
  queue: Queue<IngestionJob>;
}

const globalForKnowledge = globalThis as typeof globalThis & {
  knowledgeRuntime?: KnowledgeRuntime;
};

function runtime() {
  if (!globalForKnowledge.knowledgeRuntime) {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for the knowledge base");
    }
    globalForKnowledge.knowledgeRuntime = {
      db: createDb(env.DATABASE_URL),
      queue: new Queue<IngestionJob>(QUEUES.ingestion, {
        connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 }),
        prefix: env.REDIS_PREFIX,
      }),
    };
  }
  return globalForKnowledge.knowledgeRuntime;
}

export async function getKnowledgeDeps(): Promise<KnowledgeDeps> {
  const { db, queue } = runtime();
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, env.TENANT));
  if (!tenant) {
    throw new Error(`Tenant "${env.TENANT}" not found; run pnpm db:seed`);
  }
  return {
    db,
    enqueue: (data) => enqueueIngestion(db, queue, data),
    filesDir: env.KNOWLEDGE_FILES_DIR,
    tenantId: tenant.id,
  };
}
