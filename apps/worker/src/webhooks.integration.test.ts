import assert from "node:assert/strict";
import { test } from "node:test";
import { createDb, tenants, webhookDeliveries, webhookEndpoints } from "@answerline/db";
import { encryptProviderCredential } from "@answerline/llm";
import type { WebhookDeliveryJob, WebhookEvent } from "@answerline/shared";
import type { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import {
  createWebhookDeliveryProcessor,
  enqueueWebhookEvent,
  signWebhookPayload,
} from "./webhooks.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const encryptionKey = "0123456789abcdef".repeat(4);
const signaturePattern = /^t=(\d+),v1=([0-9a-f]{64})$/;
const signatureHeaderPattern = /^t=\d+,v1=[0-9a-f]{64}$/;
const http503Pattern = /HTTP 503/;

test("webhook enqueue is tenant scoped and delivery retries with signed payloads", {
  skip,
}, async () => {
  const db = createDb();
  const ownSlug = `webhook-${crypto.randomUUID()}`;
  const otherSlug = `webhook-${crypto.randomUUID()}`;
  let ownTenantId: string | undefined;
  let otherTenantId: string | undefined;
  try {
    const [ownTenant] = await db
      .insert(tenants)
      .values({ name: ownSlug, slug: ownSlug })
      .returning();
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: otherSlug, slug: otherSlug })
      .returning();
    assert.ok(ownTenant);
    assert.ok(otherTenant);
    ownTenantId = ownTenant.id;
    otherTenantId = otherTenant.id;
    const encryptedSecret = encryptProviderCredential("hook-secret", encryptionKey);
    const [ownEndpoint] = await db
      .insert(webhookEndpoints)
      .values({
        encryptedSecret,
        events: ["call.ended"],
        name: "CRM",
        tenantId: ownTenantId,
        url: "https://hooks.example.test/own",
      })
      .returning();
    const [otherEndpoint] = await db
      .insert(webhookEndpoints)
      .values({
        encryptedSecret,
        events: ["call.ended"],
        name: "CRM",
        tenantId: otherTenantId,
        url: "https://hooks.example.test/other",
      })
      .returning();
    assert.ok(ownEndpoint);
    assert.ok(otherEndpoint);

    const queued: Array<{ data: WebhookDeliveryJob; options: Record<string, unknown> }> = [];
    const queue = {
      add: (_name: string, data: WebhookDeliveryJob, options: Record<string, unknown>) => {
        queued.push({ data, options });
        return Promise.resolve({});
      },
    } as unknown as Queue<WebhookDeliveryJob>;
    const event: WebhookEvent = {
      created_at: "2026-01-01T00:00:00Z",
      data: { call_id: "00000000-0000-4000-8000-000000000001" },
      id: "event-call-ended-1",
      type: "call.ended",
    };
    await enqueueWebhookEvent(db, queue, ownTenantId, event);
    await enqueueWebhookEvent(db, queue, ownTenantId, event);

    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, ownEndpoint.id),
          eq(webhookDeliveries.eventId, event.id)
        )
      );
    assert.ok(delivery);
    assert.equal(delivery.status, "pending");
    assert.equal(queued.length, 2);
    assert.equal(queued[0]?.options.jobId, queued[1]?.options.jobId);
    const otherDeliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, otherEndpoint.id));
    assert.equal(otherDeliveries.length, 0);

    let requestBody = "";
    let sendCount = 0;
    const processor = createWebhookDeliveryProcessor(db, encryptionKey, (url, init) => {
      assert.equal(url, ownEndpoint.url);
      requestBody = init?.body as string;
      const signature = new Headers(init?.headers).get("x-answerline-signature");
      assert.match(signature ?? "", signatureHeaderPattern);
      const [timestamp, digest] = signaturePattern.exec(signature ?? "") ?? [];
      assert.equal(digest, signWebhookPayload("hook-secret", timestamp ?? "", requestBody));
      sendCount += 1;
      return Promise.resolve(
        sendCount === 1 ? new Response("retry", { status: 503 }) : new Response("ok")
      );
    });
    const job = {
      attemptsMade: 0,
      data: { deliveryId: delivery.id, replay: 0 },
      opts: { attempts: 2 },
    };
    await assert.rejects(processor(job), http503Pattern);
    const [retrying] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    assert.equal(retrying?.status, "pending");
    assert.equal(retrying?.attemptCount, 1);
    assert.equal(retrying?.responseStatus, 503);

    await processor({ ...job, attemptsMade: 1 });
    const [delivered] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    assert.equal(delivered?.status, "delivered");
    assert.equal(delivered?.attemptCount, 2);
    assert.equal(delivered?.responseStatus, 200);
    assert.equal(requestBody, JSON.stringify(event));
  } finally {
    if (ownTenantId) {
      await db.delete(tenants).where(eq(tenants.id, ownTenantId));
    }
    if (otherTenantId) {
      await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    }
    await db.$client.end();
  }
});
