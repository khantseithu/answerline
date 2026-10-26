import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "./client.ts";
import { tenants, webhookDeliveries, webhookEndpoints } from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("webhook deliveries are unique per endpoint and event and follow tenant deletion", {
  skip,
}, async () => {
  const db = createDb();
  const slug = `webhooks-${crypto.randomUUID()}`;
  let tenantId: string | undefined;
  try {
    const [tenant] = await db.insert(tenants).values({ name: slug, slug }).returning();
    assert.ok(tenant);
    tenantId = tenant.id;
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        encryptedSecret: "v1.encrypted",
        events: ["call.ended"],
        name: "CRM",
        tenantId,
        url: "https://hooks.example.test",
      })
      .returning();
    assert.ok(endpoint);
    const payload = {
      created_at: "2026-01-01T00:00:00Z",
      data: { transcript_url: "https://app.example.test/api/v1/calls/call-1" },
      id: "call-1_call.ended",
      type: "call.ended" as const,
    };
    await db.insert(webhookDeliveries).values({
      endpointId: endpoint.id,
      eventId: payload.id,
      eventType: payload.type,
      payload,
      tenantId,
    });
    await db
      .insert(webhookDeliveries)
      .values({
        endpointId: endpoint.id,
        eventId: payload.id,
        eventType: payload.type,
        payload,
        tenantId,
      })
      .onConflictDoNothing({ target: [webhookDeliveries.endpointId, webhookDeliveries.eventId] });
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, endpoint.id),
          eq(webhookDeliveries.eventId, payload.id)
        )
      );
    assert.equal(rows[0]?.count, 1);
  } finally {
    if (tenantId) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await db.$client.end();
  }
});
