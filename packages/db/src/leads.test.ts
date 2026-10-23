import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { createDb } from "./client.ts";
import { agents, calls, leads, tenants } from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("leads preserve call references, deduplicate ids, and follow tenant deletion", {
  skip,
}, async () => {
  const db = createDb();
  const slug = `lead-${crypto.randomUUID()}`;
  const leadId = crypto.randomUUID();
  try {
    const [tenant] = await db.insert(tenants).values({ name: slug, slug }).returning();
    assert.ok(tenant);
    const config = parseAgentConfig(
      await readFile(new URL("../../../agents/bright-smile-dental.yaml", import.meta.url), "utf8")
    );
    const [agent] = await db
      .insert(agents)
      .values({ config, name: config.name, slug: "dental", tenantId: tenant.id })
      .returning();
    assert.ok(agent);
    const [call] = await db
      .insert(calls)
      .values({ agentId: agent.id, channel: "web", roomName: slug, tenantId: tenant.id })
      .returning();
    assert.ok(call);
    const values = {
      agentId: agent.id,
      callId: call.id,
      createdAt: new Date("2026-10-23T11:00:00.000Z"),
      id: leadId,
      name: "Alex Morgan",
      phone: "+15555550123",
      reason: "Please call back.",
      tenantId: tenant.id,
    };
    await db.insert(leads).values(values);
    await db
      .insert(leads)
      .values({ ...values, name: "Duplicate delivery" })
      .onConflictDoNothing({ target: leads.id });
    const rows = await db.select().from(leads).where(eq(leads.id, leadId));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], values);
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    assert.deepEqual(await db.select().from(leads).where(eq(leads.id, leadId)), []);
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, slug));
    await db.$client.end();
  }
});
