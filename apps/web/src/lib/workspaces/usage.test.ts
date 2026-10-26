import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, calls, createDb, evalRuns, tenants } from "@answerline/db";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import {
  assertWorkspaceUsageAvailable,
  getWorkspaceUsage,
  WorkspaceUsageLimitError,
} from "./usage";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("workspace usage counts UTC month overlap and blocks exhausted call and spend limits", {
  skip,
}, async () => {
  const db = createDb();
  const id = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const tenantSlug = `usage-${id}`;
  const periodStart = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-01-01T00:01:00.000Z");
  try {
    await db.insert(tenants).values({
      id: tenantId,
      monthlyCallMinutesLimit: 2,
      monthlyProviderSpendLimitUsd: "0.50",
      name: tenantSlug,
      slug: tenantSlug,
    });
    const config = parseAgentConfig(
      await readFile(
        new URL("../../../../../agents/bright-smile-dental.yaml", import.meta.url),
        "utf8"
      )
    );
    const [agent] = await db
      .insert(agents)
      .values({ config, name: config.name, slug: "usage-agent", tenantId })
      .returning();
    assert.ok(agent);
    await db.insert(calls).values([
      {
        agentId: agent.id,
        channel: "web",
        costUsd: "0.40",
        endedAt: new Date("2026-01-01T00:01:00.000Z"),
        roomName: `usage-cross-month-${id}`,
        startedAt: new Date("2025-12-31T23:59:00.000Z"),
        status: "completed",
        tenantId,
      },
      {
        agentId: agent.id,
        channel: "web",
        costUsd: "0.10",
        endedAt: now,
        roomName: `usage-current-month-${id}`,
        startedAt: periodStart,
        status: "completed",
        tenantId,
      },
    ]);
    await db.insert(evalRuns).values({
      agentId: agent.id,
      costUsd: "0.40",
      createdAt: new Date("2026-01-01T00:01:00.000Z"),
      status: "completed",
      suite: "usage",
      tenantId,
    });

    const usage = await getWorkspaceUsage(db, tenantId, now);
    assert.equal(usage.callMinutesUsed, 2);
    assert.equal(usage.providerSpendUsdUsed, 0.5);
    await assert.rejects(
      assertWorkspaceUsageAvailable(db, tenantId, now),
      WorkspaceUsageLimitError
    );
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.$client.end();
  }
});
