import assert from "node:assert/strict";
import { test } from "node:test";
import { agents, calls, callTurns, createDb, tenants, toolCalls } from "@answerline/db";
import type { CallEventJob } from "@answerline/shared";
import { asc, eq } from "drizzle-orm";
import { persistCallEvent } from "./call-events.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const AGENT = "bright-smile-dental";
const MISSING_YAML = /agents\/no-such-agent\.yaml does not exist/;

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

test("call.started creates the tenant, agent from yaml, and an in-progress call", { skip }, () =>
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

test("call.ended stores the recording location and keeps it when absent", { skip }, () =>
  withTenant(async ({ base, ended, started }, db) => {
    const recordingUrl = `s3://recordings/default/${base.room_name}.ogg`;
    await persistCallEvent(db, started);
    assert.equal((await getCall(db, base.room_name)).recordingUrl, null);

    await persistCallEvent(db, { ...ended, recording_url: recordingUrl });
    assert.equal((await getCall(db, base.room_name)).recordingUrl, recordingUrl);

    await persistCallEvent(db, ended);
    assert.equal((await getCall(db, base.room_name)).recordingUrl, recordingUrl);
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

test("an existing agent is not overwritten from yaml", { skip }, () =>
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

test("an unknown agent with no yaml fails the job", { skip }, () =>
  withTenant(async ({ started }, db) => {
    await assert.rejects(
      persistCallEvent(db, { ...started, agent: "no-such-agent" }),
      MISSING_YAML
    );
  })
);
