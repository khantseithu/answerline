import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { calls, callTurns, createDb, tenants } from "@answerline/db";
import { type CallEventJob, callEventJob, callEventJobId, QUEUES } from "@answerline/shared";
import { Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { createCallEventProcessor } from "./call-events.ts";

const skip =
  process.env.DATABASE_URL && process.env.REDIS_URL ? false : "DATABASE_URL or REDIS_URL not set";
const fixtures = new URL("../../../packages/shared/fixtures/call-event/valid/", import.meta.url);

const queueJobId = (event: CallEventJob) => callEventJobId(event).replaceAll(":", "_");

async function loadFixture(name: string, room: string, tenant: string) {
  const raw = JSON.parse(await readFile(new URL(name, fixtures), "utf8"));
  return callEventJob.parse({ ...raw, room_name: room, tenant });
}

test("processes call events end to end through bullmq", { skip, timeout: 30_000 }, async () => {
  const id = crypto.randomUUID();
  const room = `room-${id}`;
  const tenant = `test-${id}`;
  const prefix = `test-${id}`;
  const db = createDb();
  const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUES.callEvents, { connection, prefix });

  const events: CallEventJob[] = await Promise.all(
    ["started-sip.json", "turn-agent.json", "turn-caller.json", "ended.json"].map((name) =>
      loadFixture(name, room, tenant)
    )
  );

  const processor = createCallEventProcessor(db);
  let worker: Worker | undefined;
  try {
    const done = new Promise<void>((resolve, reject) => {
      let completed = 0;
      worker = new Worker(QUEUES.callEvents, processor, { connection, prefix });
      worker.on("failed", (_job, error) => reject(error));
      worker.on("completed", () => {
        completed += 1;
        if (completed === events.length) {
          resolve();
        }
      });
    });

    const [first] = events;
    assert.ok(first);
    await queue.addBulk(
      [...events, first].map((event) => ({
        data: event,
        name: event.type,
        opts: { jobId: queueJobId(event) },
      }))
    );
    await done;

    const [call] = await db.select().from(calls).where(eq(calls.roomName, room));
    assert.ok(call);
    assert.equal(call.status, "completed");
    assert.equal(call.channel, "sip");
    assert.equal(call.durationMs, 180_000);
    const turns = await db.select().from(callTurns).where(eq(callTurns.callId, call.id));
    assert.deepEqual(turns.map((t) => t.seq).sort(), [0, 1]);
  } finally {
    await worker?.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
    await db.delete(tenants).where(eq(tenants.slug, tenant));
    await db.$client.end();
  }
});
