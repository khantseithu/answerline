import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { createDb } from "./client.ts";
import { agents, bookings, tenants } from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("confirmed bookings cannot overlap for the same agent", { skip }, async () => {
  const db = createDb();
  const slug = `booking-${crypto.randomUUID()}`;
  try {
    const [tenant] = await db.insert(tenants).values({ name: slug, slug }).returning();
    assert.ok(tenant);
    const config = parseAgentConfig(
      await readFile(new URL("../../../agents/bright-smile-dental.yaml", import.meta.url), "utf8")
    );
    const [first, second] = await db
      .insert(agents)
      .values([
        { config, name: config.name, slug: "dental", tenantId: tenant.id },
        { config, name: config.name, slug: "dental-2", tenantId: tenant.id },
      ])
      .returning();
    assert.ok(first && second);
    const book = (agentId: string, start: string, end: string | null) =>
      db.insert(bookings).values({
        agentId,
        endsAt: end ? new Date(end) : null,
        name: "Alex Morgan",
        provider: "answerline",
        startsAt: new Date(start),
        tenantId: tenant.id,
      });

    const [held] = await book(first.id, "2026-10-26T13:00:00Z", "2026-10-26T13:30:00Z").returning();
    assert.ok(held);
    await assert.rejects(
      book(first.id, "2026-10-26T13:15:00Z", "2026-10-26T13:45:00Z"),
      (error: unknown) =>
        (error as { cause?: { constraint_name?: string } }).cause?.constraint_name ===
        "bookings_agent_no_overlap"
    );
    await book(first.id, "2026-10-26T13:30:00Z", "2026-10-26T14:00:00Z");
    await book(second.id, "2026-10-26T13:15:00Z", "2026-10-26T13:45:00Z");
    await book(first.id, "2026-10-26T13:10:00Z", null);
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, held.id));
    await book(first.id, "2026-10-26T13:00:00Z", "2026-10-26T13:30:00Z");
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, slug));
    await db.$client.end();
  }
});
