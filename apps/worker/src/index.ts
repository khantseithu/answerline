import { createServer } from "node:http";
import { createDb } from "@answerline/db";
import { type PostCallJob, QUEUES, type WebhookDeliveryJob } from "@answerline/shared";
import { type Job, Queue, Worker } from "bullmq";
import { RoomServiceClient, SipClient } from "livekit-server-sdk";
import { createCallEventProcessor } from "./call-events.ts";
import { env } from "./env.ts";
import { createEvalProcessor } from "./evals.ts";
import { createIngestionProcessor, createKnowledgeEmbedderFactory } from "./ingestion.ts";
import { createOutboundDialProcessor } from "./outbound-calls.ts";
import { createPostCallProcessor } from "./post-call.ts";
import { createRedis } from "./redis.ts";
import { createWebhookDeliveryProcessor } from "./webhooks.ts";

if (!env.DATABASE_URL) {
  throw new Error(`DATABASE_URL is required to process the ${QUEUES.callEvents} queue`);
}

const db = createDb(env.DATABASE_URL);
const connection = createRedis();
const postCallQueue = new Queue<PostCallJob>(QUEUES.postCall, {
  connection,
  prefix: env.REDIS_PREFIX,
});
const webhookQueue = new Queue<WebhookDeliveryJob>(QUEUES.webhookDeliveries, {
  connection,
  prefix: env.REDIS_PREFIX,
});
const livekitHost = env.LIVEKIT_URL?.replace(/^ws/, "http");
const livekit =
  livekitHost && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID
    ? {
        roomServiceClient: new RoomServiceClient(
          livekitHost,
          env.LIVEKIT_API_KEY,
          env.LIVEKIT_API_SECRET
        ),
        sipClient: new SipClient(livekitHost, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET),
        trunkId: env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID,
      }
    : undefined;

const handlers: Record<string, (job: Job) => Promise<void> | void> = {
  [QUEUES.callEvents]: createCallEventProcessor(db, {
    postCallQueue,
    webhookBaseUrl: env.BETTER_AUTH_URL,
    webhookQueue,
  }),
  [QUEUES.ingestion]: createIngestionProcessor(
    db,
    createKnowledgeEmbedderFactory(db, process.env),
    {
      filesDir: env.KNOWLEDGE_FILES_DIR,
    }
  ),
  [QUEUES.postCall]: createPostCallProcessor(db),
  [QUEUES.webhookDeliveries]: createWebhookDeliveryProcessor(db, env.PROVIDER_KEYS_ENCRYPTION_KEY),
  [QUEUES.outboundCalls]: createOutboundDialProcessor({ db, livekit }),
  [QUEUES.evals]: createEvalProcessor(db, { webhookQueue }),
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

const healthServer = env.WORKER_HEALTH_PORT
  ? createServer((_request, response) => {
      const ready = connection.status === "ready" && workers.every((worker) => worker.isRunning());
      response.writeHead(ready ? 200 : 503);
      response.end(ready ? "OK" : "Not ready");
    }).listen(env.WORKER_HEALTH_PORT, "0.0.0.0")
  : undefined;

async function shutdown() {
  healthServer?.close();
  await Promise.all(workers.map((w) => w.close()));
  await postCallQueue.close();
  await webhookQueue.close();
  await connection.quit();
  await db.$client.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
