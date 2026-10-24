import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { evalExecutionInputSchema, parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { createDb } from "./client.ts";
import { agents, evalRuns, tenants } from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("eval runs persist the execution input snapshot and error", { skip }, async () => {
  const db = createDb();
  const slug = `eval-${crypto.randomUUID()}`;
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
    const executionInput = evalExecutionInputSchema.parse({
      agent: config,
      suite: [{ caller: "Hello", expect: {}, name: "greeting" }],
    });
    const [run] = await db
      .insert(evalRuns)
      .values({
        agentId: agent.id,
        error: "eval failed",
        executionInput,
        suite: "bright-smile-dental",
        tenantId: tenant.id,
      })
      .returning();
    assert.ok(run);
    const [storedRun] = await db.select().from(evalRuns).where(eq(evalRuns.id, run.id));
    assert.deepEqual(storedRun?.executionInput, executionInput);
    assert.equal(storedRun?.error, "eval failed");
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, slug));
    await db.$client.end();
  }
});
