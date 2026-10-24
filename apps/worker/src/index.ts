import { createDb } from "@answerline/db";
import { type PostCallJob, QUEUES } from "@answerline/shared";
import { type Job, Queue, Worker } from "bullmq";
import { createCallEventProcessor } from "./call-events.ts";
import { env } from "./env.ts";
import { createIngestionProcessor, createKnowledgeEmbedder } from "./ingestion.ts";
import { createPostCallProcessor } from "./post-call.ts";
import { createRedis } from "./redis.ts";

if (!env.DATABASE_URL) {
  throw new Error(`DATABASE_URL is required to process the ${QUEUES.callEvents} queue`);
}

const db = createDb(env.DATABASE_URL);
const connection = createRedis();
const postCallQueue = new Queue<PostCallJob>(QUEUES.postCall, {
  connection,
  prefix: env.REDIS_PREFIX,
});

const handlers: Record<string, (job: Job) => Promise<void> | void> = {
  [QUEUES.callEvents]: createCallEventProcessor(db, { postCallQueue }),
  [QUEUES.ingestion]: createIngestionProcessor(db, createKnowledgeEmbedder(process.env), {
    filesDir: env.KNOWLEDGE_FILES_DIR,
  }),
  [QUEUES.postCall]: createPostCallProcessor(db),
  [QUEUES.evals]: (job) => {
    console.log(`[evals] ${job.name} ${job.id}`);
  },
};

const workers = Object.entries(handlers).map(
  ([queue, handler]) =>
    new Worker(
      queue,
      async (job) => {
        await handler(job);
      },
      { connection, prefix: env.REDIS_PREFIX }
    )
);

console.log(`worker listening on queues: ${Object.keys(handlers).join(", ")}`);

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await postCallQueue.close();
  await connection.quit();
  await db.$client.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
