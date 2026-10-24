import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, calls, callTurns, createDb, tenants, toolCalls } from "@answerline/db";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { getCallDetail } from "./detail.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

async function withTenants(
  run: (input: {
    db: ReturnType<typeof createDb>;
    tenantId: string;
    otherTenantId: string;
    agentId: string;
  }) => Promise<void>
) {
  const db = createDb();
  const tenantId = crypto.randomUUID();
  const otherTenantId = crypto.randomUUID();
  try {
    await db.insert(tenants).values([
      { id: tenantId, name: `detail-${tenantId}`, slug: `detail-${tenantId}` },
      { id: otherTenantId, name: `detail-${otherTenantId}`, slug: `detail-${otherTenantId}` },
    ]);
    const config = parseAgentConfig(
      await readFile(
        new URL("../../../../../agents/bright-smile-dental.yaml", import.meta.url),
        "utf8"
      )
    );
    const [agent] = await db
      .insert(agents)
      .values({ config, name: config.name, slug: "primary", tenantId })
      .returning();
    assert.ok(agent);
    await run({ agentId: agent.id, db, otherTenantId, tenantId });
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await db.$client.end();
  }
}

test("call detail loads turns and tool calls for the owning tenant only", { skip }, () =>
  withTenants(async ({ db, agentId, otherTenantId, tenantId }) => {
    const startedAt = new Date("2026-10-24T10:00:00.000Z");
    const [call] = await db
      .insert(calls)
      .values({
        agentId,
        channel: "sip",
        costUsd: "0.001234",
        fromNumber: "+15550001111",
        recordingStartedAt: new Date("2026-10-24T10:00:01.000Z"),
        recordingUrl: "s3://recordings/acme/call.ogg",
        roomName: `detail-${crypto.randomUUID()}`,
        startedAt,
        tenantId,
      })
      .returning();
    assert.ok(call);
    await db.insert(callTurns).values([
      {
        callId: call.id,
        latency: { llmTtftMs: 320, sttMs: 90, ttsTtfbMs: 110 },
        role: "agent",
        seq: 1,
        startedAt: new Date("2026-10-24T10:00:05.000Z"),
        text: "Second line",
      },
      {
        callId: call.id,
        role: "caller",
        seq: 0,
        startedAt: new Date("2026-10-24T10:00:02.000Z"),
        text: "First line",
      },
    ]);
    await db.insert(toolCalls).values({
      args: { day: "monday" },
      callId: call.id,
      latencyMs: 40,
      name: "check_availability",
      result: { slots: 2 },
      seq: 0,
      status: "ok",
    });

    const detail = await getCallDetail(db, tenantId, call.id);
    assert.ok(detail);
    assert.equal(detail.agentName, "Bright Smile Dental");
    assert.equal(detail.hasRecording, true);
    assert.equal(detail.recordingStartedAt?.toISOString(), "2026-10-24T10:00:01.000Z");
    assert.deepEqual(
      detail.turns.map((turn) => turn.text),
      ["First line", "Second line"]
    );
    assert.equal(detail.turns[1]?.latency?.llmTtftMs, 320);
    assert.equal(detail.toolCalls[0]?.name, "check_availability");
    assert.equal("recordingUrl" in detail, false);

    assert.equal(await getCallDetail(db, otherTenantId, call.id), null);
  })
);

test("call detail returns null for an unknown or malformed id", { skip }, () =>
  withTenants(async ({ db, tenantId }) => {
    assert.equal(await getCallDetail(db, tenantId, MISSING_ID), null);
    assert.equal(await getCallDetail(db, tenantId, "not-a-uuid"), null);
  })
);
