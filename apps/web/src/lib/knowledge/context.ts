import { type IngestionJob, QUEUES } from "@answerline/shared";
import { enqueueIngestion } from "@answerline/worker/ingestion";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@/env";
import { getWorkspaceApiContext } from "@/lib/api-keys/context";
import type { WorkspaceAccess } from "@/lib/workspaces/permissions";
import type { KnowledgeDeps } from "./service";

interface KnowledgeRuntime {
  queue: Queue<IngestionJob>;
}

const globalForKnowledge = globalThis as typeof globalThis & {
  knowledgeRuntime?: KnowledgeRuntime;
};

function runtime() {
  if (!globalForKnowledge.knowledgeRuntime) {
    globalForKnowledge.knowledgeRuntime = {
      queue: new Queue<IngestionJob>(QUEUES.ingestion, {
        connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 }),
        prefix: env.REDIS_PREFIX,
      }),
    };
  }
  return globalForKnowledge.knowledgeRuntime;
}

export async function getKnowledgeDeps(access: WorkspaceAccess = "read"): Promise<KnowledgeDeps> {
  const scope = access === "read" ? "knowledge:read" : "knowledge:write";
  const { db, tenantId } = await getWorkspaceApiContext(scope, access);
  const { queue } = runtime();
  return {
    db,
    enqueue: (data) => enqueueIngestion(db, queue, data),
    filesDir: env.KNOWLEDGE_FILES_DIR,
    tenantId,
  };
}
