import { QUEUES } from "@answerline/shared";
import { type Job, Worker } from "bullmq";
import { env } from "./env.ts";
import { createRedis } from "./redis.ts";

const connection = createRedis();

const handlers: Record<string, (job: Job) => void> = {
  [QUEUES.ingestion]: (job) => {
    console.log(`[ingestion] ${job.name} ${job.id}`);
  },
  [QUEUES.postCall]: (job) => {
    console.log(`[post-call] ${job.name} ${job.id}`);
  },
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
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
