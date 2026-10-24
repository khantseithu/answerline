import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, calls, callTurns, createDb, tenants } from "@answerline/db";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { parseCallsQuery } from "./query.ts";
import { listCalls } from "./service.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

async function withCalls(
  run: (input: {
    db: ReturnType<typeof createDb>;
    tenantId: string;
    otherTenantId: string;
    agentId: string;
    otherAgentId: string;
  }) => Promise<void>
) {
  const db = createDb();
  const slug = `calls-${crypto.randomUUID()}`;
  const otherSlug = `calls-other-${crypto.randomUUID()}`;
  let tenantId: string | undefined;
  let otherTenantId: string | undefined;
  try {
    const [tenant] = await db.insert(tenants).values({ name: slug, slug }).returning();
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: otherSlug, slug: otherSlug })
      .returning();
    assert.ok(tenant);
    assert.ok(otherTenant);
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;
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
    const [otherAgent] = await db
      .insert(agents)
      .values({ config, name: "Other tenant agent", slug: "other", tenantId: otherTenantId })
      .returning();
    assert.ok(agent);
    assert.ok(otherAgent);
    await run({ agentId: agent.id, db, otherAgentId: otherAgent.id, otherTenantId, tenantId });
  } finally {
    if (tenantId) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    if (otherTenantId) {
      await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    }
    await db.$client.end();
  }
}

async function addCall(
  db: ReturnType<typeof createDb>,
  tenantId: string,
  agentId: string,
  roomName: string,
  values: Partial<typeof calls.$inferInsert> = {},
  transcript = ""
) {
  const [call] = await db
    .insert(calls)
    .values({ agentId, channel: "web", roomName, tenantId, ...values })
    .returning();
  assert.ok(call);
  if (transcript) {
    await db.insert(callTurns).values({
      callId: call.id,
      role: "caller",
      seq: 0,
      startedAt: call.startedAt,
      text: transcript,
    });
  }
  return call;
}

test("lists tenant calls with combined filters and inclusive UTC date bounds", { skip }, () =>
  withCalls(async ({ db, tenantId, otherTenantId, agentId, otherAgentId }) => {
    const matching = await addCall(
      db,
      tenantId,
      agentId,
      `match-${crypto.randomUUID()}`,
      {
        channel: "sip",
        costUsd: "0.000000",
        outcome: "booked",
        startedAt: new Date("2026-10-24T23:59:59.999Z"),
      },
      "CASE sensitive literal 100%_Ready"
    );
    await addCall(
      db,
      tenantId,
      agentId,
      `wrong-channel-${crypto.randomUUID()}`,
      { channel: "web", outcome: "booked", startedAt: new Date("2026-10-24T12:00:00Z") },
      "case sensitive literal 100%_Ready"
    );
    await addCall(
      db,
      tenantId,
      agentId,
      `next-day-${crypto.randomUUID()}`,
      { channel: "sip", outcome: "booked", startedAt: new Date("2026-10-25T00:00:00Z") },
      "case sensitive literal 100%_Ready"
    );
    await addCall(
      db,
      otherTenantId,
      otherAgentId,
      `foreign-${crypto.randomUUID()}`,
      { channel: "sip", outcome: "booked", startedAt: new Date("2026-10-24T20:00:00Z") },
      "case sensitive literal 100%_Ready"
    );

    const result = await listCalls(db, tenantId, {
      agentId,
      channel: "sip",
      from: "2026-10-24",
      outcome: "booked",
      page: 1,
      pageSize: 25,
      q: "cAsE sensitive literal 100%_Ready",
      to: "2026-10-24",
    });
    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.id, matching.id);
    assert.equal(result.items[0]?.costUsd, "0.000000");
  })
);

test("transcript search treats percent, underscore, and backslash literally", { skip }, () =>
  withCalls(async ({ db, tenantId, agentId }) => {
    const literal = await addCall(
      db,
      tenantId,
      agentId,
      `literal-${crypto.randomUUID()}`,
      {},
      "call me at 100%_ready\\now"
    );
    await addCall(
      db,
      tenantId,
      agentId,
      `wildcard-${crypto.randomUUID()}`,
      {},
      "call me at 100XYready\\now"
    );
    const result = await listCalls(db, tenantId, {
      page: 1,
      pageSize: 25,
      q: "%_READY\\now",
    });
    assert.deepEqual(
      result.items.map(({ id }) => id),
      [literal.id]
    );
  })
);

test(
  "pagination is stable for equal timestamps and never returns another tenant's rows",
  { skip },
  () =>
    withCalls(async ({ db, tenantId, otherTenantId, agentId, otherAgentId }) => {
      const startedAt = new Date("2026-10-24T12:00:00Z");
      const ids = ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"];
      await db.insert(calls).values(
        ids.map((id) => ({
          agentId,
          channel: "web" as const,
          id,
          roomName: `page-${crypto.randomUUID()}`,
          startedAt,
          tenantId,
        }))
      );
      await addCall(db, otherTenantId, otherAgentId, `foreign-page-${crypto.randomUUID()}`, {
        startedAt,
      });
      const first = await listCalls(db, tenantId, { page: 1, pageSize: 1 });
      const second = await listCalls(db, tenantId, { page: 2, pageSize: 1 });
      assert.equal(first.total, 2);
      assert.equal(first.items[0]?.id, ids[1]);
      assert.equal(second.items[0]?.id, ids[0]);
    })
);

test("call list query parsing rejects malformed filters and omits native empty values", () => {
  assert.deepEqual(parseCallsQuery({ from: "", page: "", q: "" }).success, true);
  assert.equal(parseCallsQuery({ from: "2026-10-25", to: "2026-10-24" }).success, false);
  assert.equal(parseCallsQuery({ channel: "fax" }).success, false);
  assert.equal(parseCallsQuery({ pageSize: "101" }).success, false);
});
