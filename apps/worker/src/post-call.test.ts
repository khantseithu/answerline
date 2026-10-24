import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { bookings, calls, createDb, tenants } from "@answerline/db";
import {
  type CallEventJob,
  callEventJobId,
  type PostCallJob,
  postCallJobSchema,
  QUEUES,
} from "@answerline/shared";
import { type Job, Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { createCallEventProcessor, persistCallEvent } from "./call-events.ts";
import { createPostCallProcessor } from "./post-call.ts";

const skip =
  process.env.DATABASE_URL && process.env.REDIS_URL ? false : "DATABASE_URL or REDIS_URL not set";
const AGENT = "bright-smile-dental";
const WHAT_TIME_PATTERN = /What time do you close\?/;
const ALL_PROVIDERS_FAILED_PATTERN = /All LLM providers failed/;
const TENANT_NOT_FOUND_PATTERN = /not found for tenant/;

function events() {
  const id = crypto.randomUUID();
  const ref = { agent: AGENT, room_name: `post-call-${id}`, tenant: `post-call-${id}` };
  const started: CallEventJob = {
    ...ref,
    channel: "web",
    direction: "inbound",
    started_at: "2026-10-24T10:00:00.000Z",
    type: "call.started",
  };
  const turns: CallEventJob[] = [
    {
      ...ref,
      interrupted: false,
      role: "caller",
      seq: 0,
      started_at: "2026-10-24T10:00:00.000Z",
      text: "What time do you close?",
      type: "call.turn",
    },
    {
      ...ref,
      interrupted: false,
      role: "agent",
      seq: 1,
      started_at: "2026-10-24T10:00:01.000Z",
      text: "We close at six.",
      type: "call.turn",
    },
  ];
  const ended: CallEventJob = {
    ...ref,
    duration_ms: 4000,
    ended_at: "2026-10-24T10:00:04.000Z",
    model_usage: [
      { model: "nova-3", provider: "deepgram", quantity: 60, stage: "stt", unit: "seconds" },
      {
        model: "gpt-4.1-mini",
        provider: "openai",
        quantity: 1000,
        stage: "llm",
        unit: "input_tokens",
      },
    ],
    status: "completed",
    type: "call.ended",
  };
  return { ended, id, ref, started, turns };
}

async function startHttpFixture(response: unknown) {
  let requests = 0;
  let prompt = "";
  const server = createServer(async (request, result) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString();
    }
    requests += 1;
    prompt = JSON.parse(body).messages[1].content;
    result.writeHead(200, { "content-type": "application/json" });
    result.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
    prompt: () => prompt,
    requests: () => requests,
  };
}

async function resolveCall(db: ReturnType<typeof createDb>, roomName: string) {
  const [call] = await db.select().from(calls).where(eq(calls.roomName, roomName));
  assert.ok(call);
  return call;
}

function postCallJob(callId: string, tenantId: string) {
  return postCallJobSchema.parse({ callId, tenantId });
}

async function runPostCall(
  db: ReturnType<typeof createDb>,
  data: PostCallJob,
  processorOptions = {}
) {
  const processor = createPostCallProcessor(db, processorOptions);
  await processor({ data } as Job);
}

test("call.ended enqueues a delayed post-call analysis that persists once through Redis", {
  skip,
  timeout: 30_000,
}, async () => {
  const context = events();
  const tenantSlug = context.ref.tenant;
  const db = createDb();
  const prefix = `post-call-test-${context.id}`;
  const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
  const callQueue = new Queue(QUEUES.callEvents, { connection, prefix });
  const postQueue = new Queue<PostCallJob>(QUEUES.postCall, { connection, prefix });
  const fixture = await startHttpFixture({
    outcome: "booked",
    sentiment: "neutral",
    summary: "The caller asked about closing time and received the hours.",
  });
  const postProcessorOptions = {
    env: { OLLAMA_BASE_URL: fixture.baseUrl, POST_CALL_MODEL: "ollama/fixture" },
  };
  const callWorker = new Worker(
    QUEUES.callEvents,
    createCallEventProcessor(db, { postCallDelayMs: 0, postCallQueue: postQueue }),
    { connection, prefix }
  );
  const postWorker = new Worker(
    QUEUES.postCall,
    createPostCallProcessor(db, postProcessorOptions),
    { connection, prefix }
  );
  let completedCallJobs = 0;
  let completedPostJobs = 0;
  let resolveCallJobs!: () => void;
  let resolvePostJobs!: () => void;
  let resolveReplay!: () => void;
  const callJobsDone = new Promise<void>((resolve) => {
    resolveCallJobs = resolve;
  });
  const postJobDone = new Promise<void>((resolve) => {
    resolvePostJobs = resolve;
  });
  const replayDone = new Promise<void>((resolve) => {
    resolveReplay = resolve;
  });
  callWorker.on("completed", () => {
    completedCallJobs += 1;
    if (completedCallJobs === context.turns.length + 2) {
      resolveCallJobs();
    }
  });
  postWorker.on("completed", () => {
    completedPostJobs += 1;
    if (completedPostJobs === 1) {
      resolvePostJobs();
    }
    if (completedPostJobs === 2) {
      resolveReplay();
    }
  });
  const orderedEvents = [context.started, ...context.turns, context.ended];
  try {
    await callQueue.addBulk(
      orderedEvents.map((event) => ({
        data: event,
        name: event.type,
        opts: { jobId: callEventJobId(event) },
      }))
    );
    await Promise.all([callJobsDone, postJobDone]);

    const call = await resolveCall(db, context.ref.room_name);
    assert.equal(call.summary, "The caller asked about closing time and received the hours.");
    assert.equal(call.outcome, "unknown");
    assert.equal(call.sentiment, "neutral");
    assert.equal(call.costUsd, "0.005200");
    assert.equal(fixture.requests(), 1);
    assert.match(fixture.prompt(), WHAT_TIME_PATTERN);

    await postQueue.add("analyze", postCallJob(call.id, call.tenantId), {
      jobId: `replay_${context.id}`,
    });
    await replayDone;
    assert.equal(fixture.requests(), 1);
  } finally {
    await Promise.all([callWorker.close(), postWorker.close()]);
    await callQueue.obliterate({ force: true });
    await postQueue.obliterate({ force: true });
    await Promise.all([callQueue.close(), postQueue.close(), fixture.close()]);
    await connection.quit();
    await db.delete(tenants).where(eq(tenants.slug, tenantSlug));
    await db.$client.end();
  }
});

test("no-transcript analysis is deterministic and failed calls stay failed", { skip }, async () => {
  const context = events();
  const db = createDb();
  try {
    await persistCallEvent(db, context.started);
    await persistCallEvent(db, { ...context.ended, model_usage: undefined, status: "failed" });
    const call = await resolveCall(db, context.ref.room_name);

    await runPostCall(db, postCallJob(call.id, call.tenantId));

    const updated = await resolveCall(db, context.ref.room_name);
    assert.equal(updated.summary, "No transcript was recorded for this call.");
    assert.equal(updated.outcome, "failed");
    assert.equal(updated.sentiment, "unknown");
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, context.ref.tenant));
    await db.$client.end();
  }
});

test("failed model output does not write partial analysis", { skip }, async () => {
  const context = events();
  const db = createDb();
  try {
    await persistCallEvent(db, context.started);
    await persistCallEvent(db, context.turns[0] as CallEventJob);
    await persistCallEvent(db, context.ended);
    const call = await resolveCall(db, context.ref.room_name);

    await assert.rejects(
      runPostCall(db, postCallJob(call.id, call.tenantId), {
        env: { POST_CALL_MODEL: "openai/gpt-4.1-mini" },
      }),
      ALL_PROVIDERS_FAILED_PATTERN
    );
    const unchanged = await resolveCall(db, context.ref.room_name);
    assert.equal(unchanged.summary, null);
    assert.equal(unchanged.outcome, null);
    assert.equal(unchanged.sentiment, null);
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, context.ref.tenant));
    await db.$client.end();
  }
});

test("confirmed booking evidence overrides the model's outcome", { skip }, async () => {
  const context = events();
  const db = createDb();
  const fixture = await startHttpFixture({
    outcome: "unresolved",
    sentiment: "neutral",
    summary: "The caller confirmed an appointment.",
  });
  try {
    await persistCallEvent(db, context.started);
    await persistCallEvent(db, context.turns[0] as CallEventJob);
    await persistCallEvent(db, context.ended);
    const call = await resolveCall(db, context.ref.room_name);
    await db.insert(bookings).values({
      agentId: call.agentId,
      callId: call.id,
      name: "Alex Morgan",
      provider: "answerline",
      startsAt: new Date("2026-10-25T10:00:00.000Z"),
      tenantId: call.tenantId,
    });

    await runPostCall(db, postCallJob(call.id, call.tenantId), {
      env: { OLLAMA_BASE_URL: fixture.baseUrl, POST_CALL_MODEL: "ollama/fixture" },
    });

    assert.equal((await resolveCall(db, context.ref.room_name)).outcome, "booked");
  } finally {
    await fixture.close();
    await db.delete(tenants).where(eq(tenants.slug, context.ref.tenant));
    await db.$client.end();
  }
});

test("a stale tenant identity cannot analyze another tenant's call", { skip }, async () => {
  const context = events();
  const db = createDb();
  try {
    await persistCallEvent(db, context.started);
    await persistCallEvent(db, context.ended);
    const call = await resolveCall(db, context.ref.room_name);

    await assert.rejects(
      runPostCall(db, postCallJob(call.id, crypto.randomUUID())),
      TENANT_NOT_FOUND_PATTERN
    );
    assert.equal((await resolveCall(db, context.ref.room_name)).summary, null);
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, context.ref.tenant));
    await db.$client.end();
  }
});
