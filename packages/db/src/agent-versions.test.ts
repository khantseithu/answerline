import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { createDb } from "./client.ts";
import { agents, agentVersions, tenants } from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("agent history is versioned, unique, and deleted with its agent", { skip }, async () => {
  const db = createDb();
  const slug = `versions-${crypto.randomUUID()}`;
  try {
    const [tenant] = await db.insert(tenants).values({ name: slug, slug }).returning();
    assert.ok(tenant);
    const config = parseAgentConfig(
      await readFile(new URL("../../../agents/bright-smile-dental.yaml", import.meta.url), "utf8")
    );
    const [agent] = await db
      .insert(agents)
      .values({ config, name: config.name, slug, tenantId: tenant.id })
      .returning();
    assert.ok(agent);
    assert.equal(agent.version, 1);
    await db.insert(agentVersions).values({ agentId: agent.id, config, version: 1 });
    await assert.rejects(
      db.insert(agentVersions).values({ agentId: agent.id, config, version: 1 })
    );
    const updated = { ...config, greeting: "Welcome back" };
    await db.transaction(async (tx) => {
      await tx.update(agents).set({ config: updated, version: 2 }).where(eq(agents.id, agent.id));
      await tx.insert(agentVersions).values({ agentId: agent.id, config: updated, version: 2 });
    });
    const history = await db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agent.id))
      .orderBy(agentVersions.version);
    assert.deepEqual(
      history.map((entry) => entry.config.greeting),
      [config.greeting, updated.greeting]
    );
    await db.delete(agents).where(eq(agents.id, agent.id));
    assert.deepEqual(
      await db.select().from(agentVersions).where(eq(agentVersions.agentId, agent.id)),
      []
    );
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, slug));
    await db.$client.end();
  }
});
