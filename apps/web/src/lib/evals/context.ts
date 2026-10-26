import { type EvalJob, evalJobSchema, QUEUES } from "@answerline/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@/env";
import { getWorkspaceApiContext } from "@/lib/api-keys/context";
import type { WorkspaceAccess } from "@/lib/workspaces/permissions";
import { type EvalDeps, evalJobId } from "./service";
import { findEvalsDir } from "./suites";

interface EvalRuntime {
  evalsDir: string;
  queue: Queue<EvalJob>;
}

const globalForEvals = globalThis as typeof globalThis & {
  evalRuntime?: EvalRuntime;
};

function runtime() {
  if (!globalForEvals.evalRuntime) {
    globalForEvals.evalRuntime = {
      evalsDir: findEvalsDir(),
      queue: new Queue<EvalJob>(QUEUES.evals, {
        connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 }),
        prefix: env.REDIS_PREFIX,
      }),
    };
  }
  return globalForEvals.evalRuntime;
}

export async function getEvalDeps(access: WorkspaceAccess = "read"): Promise<EvalDeps> {
  const scope = access === "read" ? "evals:read" : "evals:write";
  const { db, tenantId } = await getWorkspaceApiContext(scope, access);
  const { evalsDir, queue } = runtime();
  return {
    db,
    enqueue: (data) => {
      const job = evalJobSchema.parse(data);
      return queue.add("run-eval", job, {
        jobId: evalJobId(job.runId),
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
    },
    evalsDir,
    tenantId,
  };
}
