import { createHmac } from "node:crypto";
import { type Database, webhookDeliveries, webhookEndpoints } from "@answerline/db";
import { decryptProviderCredential } from "@answerline/llm";
import {
  type WebhookDeliveryJob,
  type WebhookEvent,
  webhookDeliveryJobSchema,
  webhookEventSchema,
} from "@answerline/shared";
import { type Queue, UnrecoverableError } from "bullmq";
import { and, arrayContains, eq, isNull } from "drizzle-orm";

const webhookRetries = 5;
const webhookRetryDelayMs = 5000;
const maxResponseBodyLength = 4000;

export function signWebhookPayload(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function enqueueWebhookEvent(
  db: Database,
  queue: Queue<WebhookDeliveryJob>,
  tenantId: string,
  rawEvent: WebhookEvent
) {
  const event = webhookEventSchema.parse(rawEvent);
  const endpoints = await db
    .select({ id: webhookEndpoints.id, tenantId: webhookEndpoints.tenantId })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.enabled, true),
        isNull(webhookEndpoints.deletedAt),
        eq(webhookEndpoints.tenantId, tenantId),
        arrayContains(webhookEndpoints.events, [event.type])
      )
    );

  await Promise.all(
    endpoints.map(async (endpoint) => {
      const [inserted] = await db
        .insert(webhookDeliveries)
        .values({
          endpointId: endpoint.id,
          eventId: event.id,
          eventType: event.type,
          payload: event,
          tenantId: endpoint.tenantId,
        })
        .onConflictDoNothing({ target: [webhookDeliveries.endpointId, webhookDeliveries.eventId] })
        .returning({ id: webhookDeliveries.id });
      const [existing] = inserted
        ? [inserted]
        : await db
            .select({ id: webhookDeliveries.id })
            .from(webhookDeliveries)
            .where(
              and(
                eq(webhookDeliveries.endpointId, endpoint.id),
                eq(webhookDeliveries.eventId, event.id)
              )
            )
            .limit(1);
      const deliveryId = existing?.id;
      if (deliveryId) {
        await queue.add(
          "deliver",
          { deliveryId, replay: 0 },
          {
            attempts: webhookRetries,
            backoff: { delay: webhookRetryDelayMs, type: "exponential" },
            jobId: `${deliveryId}_r0`,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          }
        );
      }
    })
  );
}

interface DeliveryAttempt {
  attemptsMade: number;
  data: unknown;
  opts: { attempts?: number };
}

async function sendWebhookDelivery(
  db: Database,
  send: typeof fetch,
  delivery: { payload: WebhookEvent; url: string },
  deliveryId: string,
  secret: string,
  attemptCount: number,
  attempts: number,
  attemptsMade: number
) {
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload(secret, timestamp, body);
  try {
    const response = await send(delivery.url, {
      body,
      headers: {
        "content-type": "application/json",
        "user-agent": "Answerline-Webhooks/1.0",
        "x-answerline-delivery": deliveryId,
        "x-answerline-event": delivery.payload.type,
        "x-answerline-signature": `t=${timestamp},v1=${signature}`,
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const responseBody = (await response.text()).slice(0, maxResponseBodyLength);
    if (!response.ok) {
      throw Object.assign(new Error(`Webhook receiver returned HTTP ${response.status}`), {
        responseBody,
        responseStatus: response.status,
      });
    }
    await db
      .update(webhookDeliveries)
      .set({
        attemptCount,
        deliveredAt: new Date(),
        lastError: null,
        nextAttemptAt: null,
        responseBody,
        responseStatus: response.status,
        status: "delivered",
      })
      .where(eq(webhookDeliveries.id, deliveryId));
  } catch (error) {
    const details = error instanceof Error ? error : new Error("Unknown webhook delivery failure");
    const response = details as Error & { responseBody?: string; responseStatus?: number };
    const terminal = attemptCount >= attempts;
    await db
      .update(webhookDeliveries)
      .set({
        attemptCount,
        lastError: details.message.slice(0, 1000),
        nextAttemptAt: terminal
          ? null
          : new Date(Date.now() + webhookRetryDelayMs * 2 ** attemptsMade),
        responseBody: response.responseBody,
        responseStatus: response.responseStatus,
        status: terminal ? "failed" : "pending",
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    throw details;
  }
}

export function createWebhookDeliveryProcessor(
  db: Database,
  encryptionKey: string | undefined,
  send: typeof fetch = fetch
) {
  return async (job: DeliveryAttempt) => {
    const data = webhookDeliveryJobSchema.parse(job.data);
    const [delivery] = await db
      .select({
        deletedAt: webhookEndpoints.deletedAt,
        enabled: webhookEndpoints.enabled,
        encryptedSecret: webhookEndpoints.encryptedSecret,
        id: webhookDeliveries.id,
        payload: webhookDeliveries.payload,
        status: webhookDeliveries.status,
        tenantId: webhookDeliveries.tenantId,
        url: webhookEndpoints.url,
      })
      .from(webhookDeliveries)
      .innerJoin(
        webhookEndpoints,
        and(
          eq(webhookEndpoints.id, webhookDeliveries.endpointId),
          eq(webhookEndpoints.tenantId, webhookDeliveries.tenantId)
        )
      )
      .where(eq(webhookDeliveries.id, data.deliveryId));

    if (!delivery) {
      throw new UnrecoverableError("Webhook delivery was not found");
    }
    if (delivery.status === "delivered") {
      return;
    }
    if (!delivery.enabled || delivery.deletedAt) {
      await db
        .update(webhookDeliveries)
        .set({ lastError: "Webhook endpoint is disabled", status: "failed" })
        .where(eq(webhookDeliveries.id, data.deliveryId));
      throw new UnrecoverableError("Webhook endpoint is disabled");
    }
    if (!encryptionKey) {
      await db
        .update(webhookDeliveries)
        .set({ lastError: "Webhook secret encryption key is not configured", status: "failed" })
        .where(eq(webhookDeliveries.id, data.deliveryId));
      throw new UnrecoverableError("PROVIDER_KEYS_ENCRYPTION_KEY is required for webhook delivery");
    }

    let secret: string;
    try {
      secret = decryptProviderCredential(delivery.encryptedSecret, encryptionKey);
    } catch (error) {
      await db
        .update(webhookDeliveries)
        .set({ lastError: "Webhook secret could not be decrypted", status: "failed" })
        .where(eq(webhookDeliveries.id, data.deliveryId));
      const failure = new UnrecoverableError("Webhook secret could not be decrypted");
      failure.cause = error;
      throw failure;
    }

    await sendWebhookDelivery(
      db,
      send,
      delivery,
      data.deliveryId,
      secret,
      job.attemptsMade + 1,
      job.opts.attempts ?? webhookRetries,
      job.attemptsMade
    );
  };
}
