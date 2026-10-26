import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, calls, createDb, tenants } from "@answerline/db";
import { type OutboundDialJob, parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import {
  createOutboundDialProcessor,
  hasOutboundReadyMetadata,
  waitForOutboundAgent,
} from "./outbound-calls.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const noAnswerPattern = /No answer/;
const callingHoursPattern = /calling hours/;

test("AMD readiness requires the explicit agent marker", () => {
  assert.equal(hasOutboundReadyMetadata('{"answerline":{"outbound_ready":true}}'), true);
  assert.equal(hasOutboundReadyMetadata('{"answerline":{"outbound_ready":false}}'), false);
  assert.equal(hasOutboundReadyMetadata("not json"), false);
});

test("AMD dial readiness resolves only after the agent marks the room ready", async () => {
  let polls = 0;
  await waitForOutboundAgent(
    {
      listRooms: () => {
        polls += 1;
        return Promise.resolve([{ metadata: '{"answerline":{"outbound_ready":true}}' }]);
      },
    },
    "call-1"
  );
  assert.equal(polls, 1);
});

async function withOutboundCall(
  run: (args: {
    callId: string;
    db: ReturnType<typeof createDb>;
    job: OutboundDialJob;
    tenantId: string;
  }) => Promise<void>,
  configSuffix = "outbound:\n  respect_calling_hours: false\n"
) {
  const db = createDb();
  const slug = `dial-${crypto.randomUUID()}`;
  let tenantId: string | undefined;
  try {
    const [tenant] = await db.insert(tenants).values({ name: slug, slug }).returning();
    assert.ok(tenant);
    tenantId = tenant.id;
    const source = await readFile(
      new URL("../../../agents/bright-smile-dental.yaml", import.meta.url),
      "utf8"
    );
    const config = parseAgentConfig(`${source}\n${configSuffix}`);
    const [agent] = await db
      .insert(agents)
      .values({ config, name: config.name, slug: "front-desk", tenantId })
      .returning();
    assert.ok(agent);
    const callId = crypto.randomUUID();
    const roomName = `call-${callId}`;
    const job: OutboundDialJob = {
      agent: "front-desk",
      callId,
      roomName,
      tenant: slug,
      toNumber: "+15551234567",
      waitForAgentReady: true,
    };
    await db.insert(calls).values({
      agentId: agent.id,
      channel: "sip",
      direction: "outbound",
      id: callId,
      roomName,
      tenantId,
      toNumber: job.toNumber,
    });
    await run({ callId, db, job, tenantId });
  } finally {
    if (tenantId) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await db.$client.end();
  }
}

test("outbound dialing waits for AMD readiness and waits until answered", { skip }, () =>
  withOutboundCall(async ({ db, job }) => {
    const events: string[] = [];
    const processor = createOutboundDialProcessor({
      db,
      livekit: {
        roomServiceClient: {
          deleteRoom: (roomName) => {
            events.push(`delete:${roomName}`);
            return Promise.resolve();
          },
          listParticipants: (roomName) => {
            events.push(`participants:${roomName}`);
            return Promise.resolve([]);
          },
          listRooms: (names) => {
            events.push(`ready:${names[0]}`);
            return Promise.resolve([{ metadata: '{"answerline":{"outbound_ready":true}}' }]);
          },
        },
        sipClient: {
          createSipParticipant: (_trunk, _number, roomName, options) => {
            events.push(`dial:${roomName}:${options?.waitUntilAnswered}`);
            return Promise.resolve();
          },
        },
        trunkId: "trunk-1",
      },
    });
    await processor({ attemptsMade: 0, data: job, opts: { attempts: 3 } });
    assert.deepEqual(events, [
      `ready:${job.roomName}`,
      `participants:${job.roomName}`,
      `dial:${job.roomName}:true`,
    ]);
  })
);

test("outbound dial retries and only marks the call failed after the final attempt", { skip }, () =>
  withOutboundCall(async ({ callId, db, job }) => {
    let deleted = false;
    const processor = createOutboundDialProcessor({
      db,
      livekit: {
        roomServiceClient: {
          deleteRoom: () => {
            deleted = true;
            return Promise.resolve();
          },
          listParticipants: () => Promise.resolve([]),
          listRooms: () =>
            Promise.resolve([{ metadata: '{"answerline":{"outbound_ready":true}}' }]),
        },
        sipClient: { createSipParticipant: () => Promise.reject(new Error("No answer")) },
        trunkId: "trunk-1",
      },
    });
    const attempt = (attemptsMade: number) =>
      processor({ attemptsMade, data: job, opts: { attempts: 3 } });
    await assert.rejects(attempt(0), noAnswerPattern);
    const [inProgressCall] = await db.select().from(calls).where(eq(calls.id, callId));
    assert.equal(inProgressCall?.status, "in_progress");
    assert.equal(deleted, false);
    await assert.rejects(attempt(2), noAnswerPattern);
    const [failedCall] = await db.select().from(calls).where(eq(calls.id, callId));
    assert.equal(failedCall?.status, "failed");
    assert.equal(deleted, true);
  })
);

test("outbound retry fails permanently after calling hours close", { skip }, () =>
  withOutboundCall(async ({ callId, db, job }) => {
    const processor = createOutboundDialProcessor({
      db,
      livekit: {
        roomServiceClient: {
          deleteRoom: () => Promise.resolve(),
          listParticipants: () => Promise.resolve([]),
          listRooms: () => Promise.resolve([]),
        },
        sipClient: { createSipParticipant: () => Promise.reject(new Error("must not dial")) },
        trunkId: "trunk-1",
      },
    });
    await assert.rejects(
      processor({ attemptsMade: 0, data: job, opts: { attempts: 3 } }),
      callingHoursPattern
    );
    const [failedCall] = await db.select().from(calls).where(eq(calls.id, callId));
    assert.equal(failedCall?.status, "failed");
  }, "hours:\n  timezone: UTC\n  weekdays: 25:00-25:00\noutbound:\n  respect_calling_hours: true\n")
);
