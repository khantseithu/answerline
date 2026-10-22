import { QUEUES } from "@answerline/shared";
import { type Job, Worker } from "bullmq";
import { createRedis } from "./redis.ts";

const connection = createRedis();

const handlers: Record<string, (job: Job) => Promise<void>> = {
  [QUEUES.ingestion]: async (job) => {
    console.log(`[ingestion] ${job.name} ${job.id}`);
  },
  [QUEUES.postCall]: async (job) => {
    console.log(`[post-call] ${job.name} ${job.id}`);
  },
  [QUEUES.evals]: async (job) => {
    console.log(`[evals] ${job.name} ${job.id}`);
  },
};

const workers = Object.entries(handlers).map(
  ([queue, handler]) => new Worker(queue, handler, { connection }),
);

console.log(`worker listening on queues: ${Object.keys(handlers).join(", ")}`);

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
