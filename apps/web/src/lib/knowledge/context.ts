import { type IngestionJob, QUEUES } from "@answerline/shared";
import { enqueueIngestion } from "@answerline/worker/ingestion";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@/env";
import { getDashboardContext } from "@/lib/dashboard/context";
import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/workspaces/permissions";
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
  const { db, role, tenantId } = await getDashboardContext();
  requireWorkspaceAccess(role, access);
  const { queue } = runtime();
  return {
    db,
    enqueue: (data) => enqueueIngestion(db, queue, data),
    filesDir: env.KNOWLEDGE_FILES_DIR,
    tenantId,
  };
}
