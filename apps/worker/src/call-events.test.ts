import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agents,
  bookings,
  calls,
  callTurns,
  createDb,
  leads,
  tenants,
  toolCalls,
  voicemails,
  webhookDeliveries,
  webhookEndpoints,
} from "@answerline/db";
import {
  type CallEventJob,
  type PostCallJob,
  QUEUES,
  type WebhookDeliveryJob,
} from "@answerline/shared";
import type { Queue as BullQueue } from "bullmq";
import { Queue } from "bullmq";
import { asc, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { seedCallAgent } from "./call-event-test-fixtures.ts";
import { persistCallEvent } from "./call-events.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const AGENT = "bright-smile-dental";
const LEAD_SCOPE_MISMATCH = /lead call reference does not match/;
const VOICEMAIL_SCOPE_MISMATCH = /voicemail call reference does not match/;
const START_SCOPE_MISMATCH = /call.started call reference does not match/;
const CALL_SCOPE_MISMATCH = /call reference does not match the tenant and agent/;
const AGENT_NOT_FOUND = /agent not found in workspace/;

type EventOf<T extends CallEventJob["type"]> = Extract<CallEventJob, { type: T }>;

function persistInOrder(db: ReturnType<typeof createDb>, events: CallEventJob[]) {
  return events.reduce(
    (previous, event) => previous.then(() => persistCallEvent(db, event)),
    Promise.resolve()
  );
}

function context() {
  const id = crypto.randomUUID();
  const base = { agent: AGENT, room_name: `room-${id}`, tenant: `test-${id}` };
  const started: EventOf<"call.started"> = {
    ...base,
    channel: "sip",
    direction: "inbound",
    from_number: "+15555550123",
    started_at: "2026-10-22T14:00:00.000Z",
    to_number: "+15555550100",
    type: "call.started",
  };
  const turn = (seq: number, role: "caller" | "agent" = "caller"): EventOf<"call.turn"> => ({
    ...base,
    interrupted: false,
    role,
    seq,
    started_at: `2026-10-22T14:00:0${seq}.000Z`,
    text: `turn ${seq}`,
    type: "call.turn",
  });
  const tool = (
    seq: number,
    overrides: Partial<EventOf<"call.tool">> = {}
  ): EventOf<"call.tool"> => ({
    ...base,
    args: { query: `question ${seq}` },
    latency_ms: 150,
    name: "search_knowledge",
    result: `answer ${seq}`,
    seq,
    started_at: `2026-10-22T14:00:1${seq}.000Z`,
    status: "ok",
    type: "call.tool",
    ...overrides,
  });
  const ended: EventOf<"call.ended"> = {
    ...base,
    duration_ms: 180_000,
    ended_at: "2026-10-22T14:03:00.000Z",
    status: "completed",
    type: "call.ended",
    usage: { stt_seconds: 92.5 },
  };
  return { base, ended, id, started, tool, turn };
}

async function withTenant(
  run: (ctx: ReturnType<typeof context>, db: ReturnType<typeof createDb>) => Promise<void>
) {
  const db = createDb();
  const ctx = context();
  try {
    await seedCallAgent(db, ctx.base.tenant);
    await run(ctx, db);
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, ctx.base.tenant));
    await db.$client.end();
  }
}

async function getCall(db: ReturnType<typeof createDb>, roomName: string) {
  const [call] = await db.select().from(calls).where(eq(calls.roomName, roomName));
  assert.ok(call);
  return call;
}

async function getTurns(db: ReturnType<typeof createDb>, callId: string) {
  return await db
    .select()
    .from(callTurns)
    .where(eq(callTurns.callId, callId))
    .orderBy(asc(callTurns.seq));
}

test("call.started resolves the workspace agent and creates an in-progress call", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    await persistCallEvent(db, started);

    const call = await getCall(db, base.room_name);
    assert.equal(call.channel, "sip");
    assert.equal(call.direction, "inbound");
    assert.equal(call.fromNumber, "+15555550123");
    assert.equal(call.toNumber, "+15555550100");
    assert.equal(call.status, "in_progress");
    assert.equal(call.startedAt.toISOString(), "2026-10-22T14:00:00.000Z");

    const [agent] = await db.select().from(agents).where(eq(agents.id, call.agentId));
    assert.equal(agent?.slug, AGENT);
    assert.equal(agent?.name, "Bright Smile Dental");
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, call.tenantId));
    assert.equal(tenant?.slug, base.tenant);
  })
);

test("call.turn stores latency in the schema shape", { skip }, () =>
  withTenant(async ({ base, started, turn }, db) => {
    await persistCallEvent(db, started);
    await persistCallEvent(db, {
      ...turn(1),
      ended_at: "2026-10-22T14:00:03.000Z",
      interrupted: true,
      latency: { llm_ttft_ms: 420, stt_ms: 180, tts_ttfb_ms: 210 },
    });

    const call = await getCall(db, base.room_name);
    const [row] = await getTurns(db, call.id);
    assert.equal(row?.role, "caller");
    assert.equal(row?.interrupted, true);
    assert.equal(row?.endedAt?.toISOString(), "2026-10-22T14:00:03.000Z");
    assert.deepEqual(row?.latency, { llmTtftMs: 420, sttMs: 180, ttsTtfbMs: 210 });
  })
);

async function getToolCalls(db: ReturnType<typeof createDb>, callId: string) {
  return await db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.callId, callId))
    .orderBy(asc(toolCalls.seq));
}

test("call.tool stores args, result, status, and latency", { skip }, () =>
  withTenant(async ({ base, started, tool }, db) => {
    await persistCallEvent(db, started);
    await persistCallEvent(db, tool(0));
    await persistCallEvent(
      db,
      tool(1, {
        args: { slot: { day: "mon" } },
        error: "boom",
        result: { citations: [{ page: 2 }], text: "x" },
        status: "error",
      })
    );
    await persistCallEvent(db, tool(2, { result: undefined, status: "timeout" }));

    const call = await getCall(db, base.room_name);
    const rows = await getToolCalls(db, call.id);
    assert.equal(rows.length, 3);
    const [first, second, third] = rows;
    assert.equal(first?.name, "search_knowledge");
    assert.deepEqual(first?.args, { query: "question 0" });
    assert.equal(first?.result, "answer 0");
    assert.equal(first?.status, "ok");
    assert.equal(first?.error, null);
    assert.equal(first?.latencyMs, 150);
    assert.equal(first?.createdAt.toISOString(), "2026-10-22T14:00:10.000Z");
    assert.deepEqual(second?.args, { slot: { day: "mon" } });
    assert.deepEqual(second?.result, { citations: [{ page: 2 }], text: "x" });
    assert.equal(second?.status, "error");
    assert.equal(second?.error, "boom");
    assert.equal(third?.result, null);
    assert.equal(third?.status, "timeout");
  })
);

test("confirmed booking tool results enqueue one stable booking webhook", { skip }, () =>
  withTenant(async ({ base, started, tool }, db) => {
    await persistCallEvent(db, started);
    const call = await getCall(db, base.room_name);
    const bookingId = crypto.randomUUID();
    const startsAt = new Date("2026-10-27T10:00:00.000Z");
    await db.insert(bookings).values({
      agentId: call.agentId,
      callId: null,
      id: bookingId,
      name: "Alex Caller",
      phone: "+15555550123",
      provider: "answerline",
      startsAt,
      tenantId: call.tenantId,
    });
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        encryptedSecret: "encrypted",
        events: ["booking.created"],
        name: "Booking CRM",
        tenantId: call.tenantId,
        url: "https://hooks.example.test/bookings",
      })
      .returning();
    assert.ok(endpoint);

    const queued: Array<{ data: WebhookDeliveryJob; options: Record<string, unknown> }> = [];
    const webhookQueue = {
      add: (_name: string, data: WebhookDeliveryJob, options: Record<string, unknown>) => {
        queued.push({ data, options });
        return Promise.resolve({});
      },
    } as unknown as BullQueue<WebhookDeliveryJob>;
    const confirmation = tool(1, {
      args: { confirmation_id: "c1" },
      name: "confirm_booking",
      result: {
        booking_id: bookingId,
        end: "2026-10-27T10:30:00.000Z",
        start: startsAt.toISOString(),
        status: "confirmed",
      },
    });
    await persistCallEvent(db, confirmation, { webhookQueue });
    await persistCallEvent(db, confirmation, { webhookQueue });

    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpoint.id));
    assert.ok(delivery);
    assert.equal(delivery.eventType, "booking.created");
    assert.equal(delivery.eventId, `booking_${bookingId}_created`);
    assert.deepEqual(delivery.payload.data, {
      agent_id: call.agentId,
      call_id: call.id,
      name: "Alex Caller",
      phone: "+15555550123",
      starts_at: startsAt.toISOString(),
    });
    assert.equal(queued.length, 2);
    assert.equal(queued[0]?.options.jobId, queued[1]?.options.jobId);
    const [savedBooking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    assert.equal(savedBooking?.callId, call.id);
  })
);

test("a tool call before call.started is filled in by the later start", { skip }, () =>
  withTenant(async ({ base, started, tool }, db) => {
    await persistCallEvent(db, tool(0));
    const placeholder = await getCall(db, base.room_name);

    await persistCallEvent(db, started);
    const call = await getCall(db, base.room_name);
    assert.equal(call.id, placeholder.id);
    assert.equal(call.channel, "sip");
    assert.equal((await getToolCalls(db, call.id)).length, 1);
  })
);

test("call.ended records status, duration, and usage", { skip }, () =>
  withTenant(async ({ base, ended, started }, db) => {
    await persistCallEvent(db, started);
    await persistCallEvent(db, { ...ended, status: "failed" });

    const call = await getCall(db, base.room_name);
    assert.equal(call.status, "failed");
    assert.equal(call.durationMs, 180_000);
    assert.equal(call.endedAt?.toISOString(), "2026-10-22T14:03:00.000Z");
    assert.deepEqual(call.usage, { stt_seconds: 92.5 });
  })
);

test("call.ended persists normalized usage and calculated cost idempotently", { skip }, () =>
  withTenant(async ({ base, ended, started }, db) => {
    const event: EventOf<"call.ended"> = {
      ...ended,
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
    };
    await persistCallEvent(db, started);
    await persistCallEvent(db, event);
    await persistCallEvent(db, event);

    const call = await getCall(db, base.room_name);
    assert.equal(call.costUsd, "0.005200");
    assert.deepEqual(call.modelUsage, event.model_usage);
    assert.equal(call.costBreakdown?.length, 2);
  })
);

test("call.ended stores the recording location and keeps it when absent", { skip }, () =>
  withTenant(async ({ base, ended, started }, db) => {
    const recordingUrl = `s3://recordings/default/${base.room_name}.ogg`;
    const recordingStartedAt = "2026-10-22T14:00:02.000Z";
    await persistCallEvent(db, started);
    assert.equal((await getCall(db, base.room_name)).recordingUrl, null);
    assert.equal((await getCall(db, base.room_name)).recordingStartedAt, null);

    await persistCallEvent(db, {
      ...ended,
      recording_started_at: recordingStartedAt,
      recording_url: recordingUrl,
    });
    const recorded = await getCall(db, base.room_name);
    assert.equal(recorded.recordingUrl, recordingUrl);
    assert.equal(recorded.recordingStartedAt?.toISOString(), recordingStartedAt);

    await persistCallEvent(db, ended);
    const kept = await getCall(db, base.room_name);
    assert.equal(kept.recordingUrl, recordingUrl);
    assert.equal(kept.recordingStartedAt?.toISOString(), recordingStartedAt);
  })
);

test("a turn before call.started is filled in by the later start", { skip }, () =>
  withTenant(async ({ base, started, turn }, db) => {
    await persistCallEvent(db, turn(0, "agent"));
    const placeholder = await getCall(db, base.room_name);
    assert.equal(placeholder.status, "in_progress");

    await persistCallEvent(db, started);
    const call = await getCall(db, base.room_name);
    assert.equal(call.id, placeholder.id);
    assert.equal(call.channel, "sip");
    assert.equal(call.fromNumber, "+15555550123");
    assert.equal(call.startedAt.toISOString(), "2026-10-22T14:00:00.000Z");
    assert.equal((await getTurns(db, call.id)).length, 1);
  })
);

test("call.ended before call.started keeps the end state", { skip }, () =>
  withTenant(async ({ base, ended, started }, db) => {
    await persistCallEvent(db, ended);
    await persistCallEvent(db, started);

    const call = await getCall(db, base.room_name);
    assert.equal(call.status, "completed");
    assert.equal(call.durationMs, 180_000);
    assert.equal(call.channel, "sip");
    assert.equal(call.startedAt.toISOString(), "2026-10-22T14:00:00.000Z");
  })
);

test("duplicate delivery is idempotent", { skip }, () =>
  withTenant(async ({ base, ended, started, tool, turn }, db) => {
    const events = [started, turn(0), tool(0), tool(1), turn(1, "agent"), ended];
    await persistInOrder(db, [...events, ...events]);

    const rows = await db.select().from(calls).where(eq(calls.roomName, base.room_name));
    assert.equal(rows.length, 1);
    const call = await getCall(db, base.room_name);
    assert.equal((await getTurns(db, call.id)).length, 2);
    assert.equal((await getToolCalls(db, call.id)).length, 2);
    assert.equal(call.status, "completed");
    const tenantAgents = await db.select().from(agents).where(eq(agents.tenantId, call.tenantId));
    assert.equal(tenantAgents.length, 1);
  })
);

test("call events preserve an existing agent configuration", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    await persistCallEvent(db, started);
    const call = await getCall(db, base.room_name);
    await db.update(agents).set({ name: "Edited" }).where(eq(agents.id, call.agentId));

    await persistCallEvent(db, { ...started, from_number: "+15555550999" });
    const [agent] = await db.select().from(agents).where(eq(agents.id, call.agentId));
    assert.equal(agent?.name, "Edited");
    assert.equal((await getCall(db, base.room_name)).fromNumber, "+15555550999");
  })
);

test("an unknown agent fails without provisioning it from YAML", { skip }, () =>
  withTenant(async ({ started }, db) => {
    await assert.rejects(
      persistCallEvent(db, { ...started, agent: "no-such-agent" }),
      AGENT_NOT_FOUND
    );
  })
);

test("lead.created persists caller details once even before call.started", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    const event: EventOf<"lead.created"> = {
      ...base,
      created_at: "2026-10-22T14:00:10.000Z",
      lead_id: crypto.randomUUID(),
      name: "Alex Morgan",
      phone: "+15555550123",
      reason: "Please call back.",
      type: "lead.created",
    };
    await persistCallEvent(db, event);
    const placeholder = await getCall(db, base.room_name);
    await persistCallEvent(db, { ...event, name: "Duplicate delivery" });
    await persistCallEvent(db, started);
    const call = await getCall(db, base.room_name);
    const rows = await db.select().from(leads).where(eq(leads.callId, call.id));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      agentId: call.agentId,
      callId: call.id,
      createdAt: new Date(event.created_at),
      id: event.lead_id,
      name: event.name,
      phone: event.phone,
      reason: event.reason,
      tenantId: call.tenantId,
    });
    assert.equal(call.id, placeholder.id);
    assert.equal(call.channel, "sip");
    assert.equal(call.startedAt.toISOString(), started.started_at);
  })
);

test("lead.created cannot attach a lead to another tenant's call", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    await persistCallEvent(db, started);
    const otherTenant = `other-${crypto.randomUUID()}`;
    await seedCallAgent(db, otherTenant);
    try {
      await assert.rejects(
        persistCallEvent(db, {
          ...base,
          created_at: "2026-10-22T14:00:10.000Z",
          lead_id: crypto.randomUUID(),
          name: "Alex Morgan",
          phone: "+15555550123",
          reason: "Please call back.",
          tenant: otherTenant,
          type: "lead.created",
        }),
        LEAD_SCOPE_MISMATCH
      );
      const call = await getCall(db, base.room_name);
      assert.deepEqual(await db.select().from(leads).where(eq(leads.callId, call.id)), []);
    } finally {
      await db.delete(tenants).where(eq(tenants.slug, otherTenant));
    }
  })
);

test("lead.created cannot attach a lead to another agent's call", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    await persistCallEvent(db, started);
    const call = await getCall(db, base.room_name);
    const [agent] = await db.select().from(agents).where(eq(agents.id, call.agentId));
    assert.ok(agent);
    await db.insert(agents).values({
      config: agent.config,
      name: agent.name,
      slug: "another-agent",
      tenantId: agent.tenantId,
    });
    await assert.rejects(
      persistCallEvent(db, {
        ...base,
        agent: "another-agent",
        created_at: "2026-10-22T14:00:10.000Z",
        lead_id: crypto.randomUUID(),
        name: "Alex Morgan",
        phone: "+15555550123",
        reason: "Please call back.",
        type: "lead.created",
      }),
      LEAD_SCOPE_MISMATCH
    );
    assert.deepEqual(await db.select().from(leads).where(eq(leads.callId, call.id)), []);
  })
);

test("voicemail.created persists the message once even before call.started", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    const event: EventOf<"voicemail.created"> = {
      ...base,
      created_at: "2026-10-22T14:00:10.000Z",
      message: "Please call me back tomorrow morning.",
      name: "Alex Morgan",
      phone: "+15555550123",
      type: "voicemail.created",
      voicemail_id: crypto.randomUUID(),
    };
    await persistCallEvent(db, event);
    const placeholder = await getCall(db, base.room_name);
    await persistCallEvent(db, { ...event, message: "Duplicate delivery" });
    await persistCallEvent(db, started);
    const call = await getCall(db, base.room_name);
    const rows = await db.select().from(voicemails).where(eq(voicemails.callId, call.id));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      agentId: call.agentId,
      callId: call.id,
      createdAt: new Date(event.created_at),
      id: event.voicemail_id,
      message: event.message,
      name: event.name,
      phone: event.phone,
      tenantId: call.tenantId,
    });
    assert.equal(call.id, placeholder.id);
    assert.equal(call.channel, "sip");
    assert.equal(call.startedAt.toISOString(), started.started_at);
  })
);

test("voicemail.created stores a message without a name or phone", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    await persistCallEvent(db, started);
    await persistCallEvent(db, {
      ...base,
      created_at: "2026-10-22T14:00:10.000Z",
      message: "Please call me back.",
      type: "voicemail.created",
      voicemail_id: crypto.randomUUID(),
    });
    const call = await getCall(db, base.room_name);
    const [row] = await db.select().from(voicemails).where(eq(voicemails.callId, call.id));
    assert.equal(row?.message, "Please call me back.");
    assert.equal(row?.name, null);
    assert.equal(row?.phone, null);
  })
);

test("voicemail.created cannot attach a voicemail to another tenant's call", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    await persistCallEvent(db, started);
    const otherTenant = `other-${crypto.randomUUID()}`;
    await seedCallAgent(db, otherTenant);
    try {
      await assert.rejects(
        persistCallEvent(db, {
          ...base,
          created_at: "2026-10-22T14:00:10.000Z",
          message: "Please call me back.",
          tenant: otherTenant,
          type: "voicemail.created",
          voicemail_id: crypto.randomUUID(),
        }),
        VOICEMAIL_SCOPE_MISMATCH
      );
      const call = await getCall(db, base.room_name);
      assert.deepEqual(
        await db.select().from(voicemails).where(eq(voicemails.callId, call.id)),
        []
      );
    } finally {
      await db.delete(tenants).where(eq(tenants.slug, otherTenant));
    }
  })
);

test("voicemail.created cannot attach a voicemail to another agent's call", { skip }, () =>
  withTenant(async ({ base, started }, db) => {
    await persistCallEvent(db, started);
    const call = await getCall(db, base.room_name);
    const [agent] = await db.select().from(agents).where(eq(agents.id, call.agentId));
    assert.ok(agent);
    await db.insert(agents).values({
      config: agent.config,
      name: agent.name,
      slug: "another-agent",
      tenantId: agent.tenantId,
    });
    await assert.rejects(
      persistCallEvent(db, {
        ...base,
        agent: "another-agent",
        created_at: "2026-10-22T14:00:10.000Z",
        message: "Please call me back.",
        type: "voicemail.created",
        voicemail_id: crypto.randomUUID(),
      }),
      VOICEMAIL_SCOPE_MISMATCH
    );
    assert.deepEqual(await db.select().from(voicemails).where(eq(voicemails.callId, call.id)), []);
  })
);

for (const scope of ["tenant", "agent"]) {
  for (const type of ["call.turn", "call.tool", "call.ended"]) {
    test(`${type} rejects a room owned by another ${scope}`, { skip }, () =>
      withTenant(async ({ base, started, ended, turn, tool }, db) => {
        await persistInOrder(db, [started, turn(0), tool(0)]);
        const before = await getCall(db, base.room_name);
        const beforeTurns = await getTurns(db, before.id);
        const beforeTools = await getToolCalls(db, before.id);
        const otherTenant = `other-${crypto.randomUUID()}`;
        await seedCallAgent(db, otherTenant);
        const [agent] = await db.select().from(agents).where(eq(agents.id, before.agentId));
        assert.ok(agent);
        if (scope === "agent") {
          await db.insert(agents).values({
            config: agent.config,
            name: agent.name,
            slug: "another-agent",
            tenantId: agent.tenantId,
          });
        }
        const event = [turn(1), tool(1), ended].find((candidate) => candidate.type === type);
        assert.ok(event);
        try {
          await assert.rejects(
            persistCallEvent(db, {
              ...event,
              ...(scope === "tenant" ? { tenant: otherTenant } : { agent: "another-agent" }),
            }),
            CALL_SCOPE_MISMATCH
          );
          assert.deepEqual(await getCall(db, base.room_name), before);
          assert.deepEqual(await getTurns(db, before.id), beforeTurns);
          assert.deepEqual(await getToolCalls(db, before.id), beforeTools);
          await persistInOrder(db, [event, event]);
          assert.equal((await getTurns(db, before.id)).length, type === "call.turn" ? 2 : 1);
          assert.equal((await getToolCalls(db, before.id)).length, type === "call.tool" ? 2 : 1);
          assert.equal(
            (await getCall(db, base.room_name)).status,
            type === "call.ended" ? "completed" : "in_progress"
          );
        } finally {
          await db.delete(tenants).where(eq(tenants.slug, otherTenant));
        }
      })
    );
  }
}

test(
  "rejected call.ended ownership does not enqueue post-call work",
  {
    skip:
      process.env.DATABASE_URL && process.env.REDIS_URL
        ? false
        : "DATABASE_URL or REDIS_URL not set",
  },
  () =>
    withTenant(async ({ base, started, ended, id }, db) => {
      const redisUrl = process.env.REDIS_URL;
      assert.ok(redisUrl);
      const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      const queue = new Queue<PostCallJob>(QUEUES.postCall, {
        connection,
        prefix: `ownership-${id}`,
      });
      const otherTenant = `other-${crypto.randomUUID()}`;
      await seedCallAgent(db, otherTenant);
      try {
        await persistCallEvent(db, started);
        const before = await getCall(db, base.room_name);
        const [agent] = await db.select().from(agents).where(eq(agents.id, before.agentId));
        assert.ok(agent);
        await db.insert(agents).values({
          config: agent.config,
          name: agent.name,
          slug: "another-agent",
          tenantId: agent.tenantId,
        });
        await Promise.all(
          [{ tenant: otherTenant }, { agent: "another-agent" }].map((identity) =>
            assert.rejects(
              persistCallEvent(db, { ...ended, ...identity }, { postCallQueue: queue }),
              CALL_SCOPE_MISMATCH
            )
          )
        );
        assert.equal(await queue.count(), 0);
        assert.deepEqual(await getCall(db, base.room_name), before);
        await persistCallEvent(db, ended, { postCallQueue: queue });
        assert.equal(await queue.count(), 1);
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
        await db.delete(tenants).where(eq(tenants.slug, otherTenant));
      }
    })
);

for (const scope of ["tenant", "agent"]) {
  test(`call.started rejects a room owned by another ${scope}`, { skip }, () =>
    withTenant(async ({ base, started, turn }, db) => {
      await persistCallEvent(db, turn(0));
      const before = await getCall(db, base.room_name);
      const otherTenant = `other-${crypto.randomUUID()}`;
      await seedCallAgent(db, otherTenant);
      const [agent] = await db.select().from(agents).where(eq(agents.id, before.agentId));
      assert.ok(agent);
      if (scope === "agent") {
        await db.insert(agents).values({
          config: agent.config,
          name: agent.name,
          slug: "another-agent",
          tenantId: agent.tenantId,
        });
      }
      try {
        await assert.rejects(
          persistCallEvent(db, {
            ...started,
            ...(scope === "tenant" ? { tenant: otherTenant } : { agent: "another-agent" }),
          }),
          START_SCOPE_MISMATCH
        );
        assert.deepEqual(await getCall(db, base.room_name), before);
        assert.equal((await getTurns(db, before.id)).length, 1);
        await persistCallEvent(db, started);
        await persistCallEvent(db, started);
        const completed = await getCall(db, base.room_name);
        assert.equal(completed.id, before.id);
        assert.equal(completed.tenantId, before.tenantId);
        assert.equal(completed.agentId, before.agentId);
        assert.equal(completed.channel, "sip");
      } finally {
        await db.delete(tenants).where(eq(tenants.slug, otherTenant));
      }
    })
  );
}

test("events cannot create unknown workspaces or agents from shared YAML", { skip }, () =>
  withTenant(async ({ started, base }, db) => {
    const unknown = `unknown-${crypto.randomUUID()}`;
    await assert.rejects(persistCallEvent(db, { ...started, tenant: unknown }), AGENT_NOT_FOUND);
    await assert.rejects(
      persistCallEvent(db, { ...started, agent: "harbor-plumbing" }),
      AGENT_NOT_FOUND
    );
    assert.deepEqual(await db.select().from(tenants).where(eq(tenants.slug, unknown)), []);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, base.tenant));
    assert.ok(tenant);
    assert.equal((await db.select().from(agents).where(eq(agents.tenantId, tenant.id))).length, 1);
    assert.deepEqual(await db.select().from(calls).where(eq(calls.roomName, base.room_name)), []);
  })
);

test("identical agent slugs persist calls and transcripts in separate workspaces", { skip }, () =>
  withTenant(async ({ started, turn, base }, db) => {
    const second = `second-${crypto.randomUUID()}`;
    await seedCallAgent(db, second);
    const room = `${base.room_name}-two`;
    try {
      await persistInOrder(db, [
        started,
        turn(0),
        { ...started, room_name: room, tenant: second },
        { ...turn(0), room_name: room, tenant: second, text: "Second workspace" },
      ]);
      const firstCall = await getCall(db, base.room_name);
      const secondCall = await getCall(db, room);
      assert.notEqual(firstCall.tenantId, secondCall.tenantId);
      assert.notEqual(firstCall.agentId, secondCall.agentId);
      assert.equal((await getTurns(db, firstCall.id))[0]?.text, "turn 0");
      assert.equal((await getTurns(db, secondCall.id))[0]?.text, "Second workspace");
    } finally {
      await db.delete(tenants).where(eq(tenants.slug, second));
    }
  })
);
