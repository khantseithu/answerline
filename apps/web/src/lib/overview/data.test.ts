import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createDb } from "@answerline/db";
import { agents, bookings, calls, tenants } from "@answerline/db/schema";
import { parseAgentConfig } from "@answerline/shared";
import { inArray } from "drizzle-orm";
import { getOverviewData } from "./data.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const NOW = new Date("2026-10-24T12:30:00.000Z");

test("overview aggregates UTC tenant calls, confirmed bookings, costs, and outcomes", {
  skip,
}, async () => {
  const db = createDb();
  const prefix = `overview-${crypto.randomUUID()}`;
  const slugs = [`${prefix}-primary`, `${prefix}-other`, `${prefix}-empty`];
  try {
    const [tenant, otherTenant, emptyTenant] = await db
      .insert(tenants)
      .values(slugs.map((slug) => ({ name: slug, slug })))
      .returning();
    assert.ok(tenant && otherTenant && emptyTenant);
    const config = parseAgentConfig(
      await readFile(
        new URL("../../../../../agents/bright-smile-dental.yaml", import.meta.url),
        "utf8"
      )
    );
    const [primaryAgent, otherAgent] = await db
      .insert(agents)
      .values([
        { config, name: config.name, slug: `${prefix}-primary`, tenantId: tenant.id },
        { config, name: config.name, slug: `${prefix}-other`, tenantId: otherTenant.id },
      ])
      .returning();
    assert.ok(primaryAgent && otherAgent);

    const insertedCalls = await db
      .insert(calls)
      .values([
        {
          agentId: primaryAgent.id,
          channel: "web",
          costUsd: "0.123456",
          durationMs: 120_000,
          endedAt: new Date("2026-10-24T00:02:00.000Z"),
          roomName: `${prefix}-start-boundary`,
          startedAt: new Date("2026-10-24T00:00:00.000Z"),
          status: "completed",
          tenantId: tenant.id,
        },
        {
          agentId: primaryAgent.id,
          channel: "sip",
          durationMs: 60_000,
          endedAt: new Date("2026-10-24T12:01:00.000Z"),
          roomName: `${prefix}-failed`,
          startedAt: new Date("2026-10-24T12:00:00.000Z"),
          status: "failed",
          tenantId: tenant.id,
        },
        {
          agentId: primaryAgent.id,
          channel: "web",
          roomName: `${prefix}-in-progress`,
          startedAt: new Date("2026-10-24T12:15:00.000Z"),
          status: "in_progress",
          tenantId: tenant.id,
        },
        {
          agentId: primaryAgent.id,
          channel: "sip",
          costUsd: "0.020000",
          endedAt: new Date("2026-10-24T11:01:00.000Z"),
          roomName: `${prefix}-unmeasured-duration`,
          startedAt: new Date("2026-10-24T11:00:00.000Z"),
          status: "completed",
          tenantId: tenant.id,
        },
        {
          agentId: primaryAgent.id,
          channel: "web",
          costUsd: "0.500000",
          durationMs: 20_000,
          endedAt: new Date("2026-10-23T23:59:30.000Z"),
          roomName: `${prefix}-previous-day`,
          startedAt: new Date("2026-10-23T23:59:00.000Z"),
          status: "completed",
          tenantId: tenant.id,
        },
        {
          agentId: primaryAgent.id,
          channel: "sip",
          costUsd: "0.900000",
          durationMs: 90_000,
          endedAt: new Date("2026-10-25T00:02:00.000Z"),
          roomName: `${prefix}-next-day`,
          startedAt: new Date("2026-10-25T00:00:00.000Z"),
          status: "completed",
          tenantId: tenant.id,
        },
        {
          agentId: otherAgent.id,
          channel: "sip",
          costUsd: "50.000000",
          durationMs: 999_000,
          endedAt: new Date("2026-10-24T12:02:00.000Z"),
          roomName: `${prefix}-other-tenant`,
          startedAt: new Date("2026-10-24T12:00:00.000Z"),
          status: "failed",
          tenantId: otherTenant.id,
        },
      ])
      .returning({ id: calls.id, roomName: calls.roomName });

    await db.insert(bookings).values([
      {
        agentId: primaryAgent.id,
        createdAt: new Date("2026-10-24T00:00:00.000Z"),
        name: "Start boundary",
        provider: "answerline",
        startsAt: new Date("2026-10-25T09:00:00.000Z"),
        tenantId: tenant.id,
      },
      {
        agentId: primaryAgent.id,
        createdAt: new Date("2026-10-24T23:59:59.000Z"),
        name: "End of day",
        provider: "answerline",
        startsAt: new Date("2026-10-25T10:00:00.000Z"),
        tenantId: tenant.id,
      },
      {
        agentId: primaryAgent.id,
        createdAt: new Date("2026-10-24T12:00:00.000Z"),
        name: "Cancelled",
        provider: "answerline",
        startsAt: new Date("2026-10-25T11:00:00.000Z"),
        status: "cancelled",
        tenantId: tenant.id,
      },
      {
        agentId: primaryAgent.id,
        createdAt: new Date("2026-10-23T23:59:59.000Z"),
        name: "Previous day",
        provider: "answerline",
        startsAt: new Date("2026-10-25T12:00:00.000Z"),
        tenantId: tenant.id,
      },
      {
        agentId: primaryAgent.id,
        createdAt: new Date("2026-10-25T00:00:00.000Z"),
        name: "Next day",
        provider: "answerline",
        startsAt: new Date("2026-10-25T13:00:00.000Z"),
        tenantId: tenant.id,
      },
      {
        agentId: otherAgent.id,
        createdAt: new Date("2026-10-24T12:00:00.000Z"),
        name: "Other tenant",
        provider: "answerline",
        startsAt: new Date("2026-10-25T09:00:00.000Z"),
        tenantId: otherTenant.id,
      },
    ]);

    const overview = await getOverviewData(db, tenant.id, NOW);
    const otherTenantCall = insertedCalls.find(
      (call) => call.roomName === `${prefix}-other-tenant`
    );
    assert.ok(otherTenantCall);
    assert.equal(overview.callsToday, 4);
    assert.equal(overview.averageDurationMs, 90_000);
    assert.equal(overview.knownCostUsd, "0.143456");
    assert.equal(overview.unpricedCalls, 2);
    assert.equal(overview.bookingsToday, 2);
    assert.equal(overview.completedOrFailedCalls, 3);
    assert.equal(overview.failedCalls, 1);
    assert.equal(overview.failureRate, 1 / 3);
    assert.ok(overview.recentCalls.every((call) => call.id !== otherTenantCall.id));

    const emptyOverview = await getOverviewData(db, emptyTenant.id, NOW);
    assert.equal(emptyOverview.callsToday, 0);
    assert.equal(emptyOverview.averageDurationMs, null);
    assert.equal(emptyOverview.knownCostUsd, null);
    assert.equal(emptyOverview.unpricedCalls, 0);
    assert.equal(emptyOverview.bookingsToday, 0);
    assert.equal(emptyOverview.failureRate, null);
    assert.deepEqual(emptyOverview.recentCalls, []);
  } finally {
    await db.delete(tenants).where(inArray(tenants.slug, slugs));
    await db.$client.end();
  }
});
