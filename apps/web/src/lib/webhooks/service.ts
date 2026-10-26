import { randomBytes } from "node:crypto";
import { type Database, webhookDeliveries, webhookEndpoints } from "@answerline/db";
import { encryptProviderCredential } from "@answerline/llm";
import {
  type WebhookDeliveryJob,
  webhookEndpointCreateSchema,
  webhookEndpointUpdateSchema,
} from "@answerline/shared";
import type { Queue } from "bullmq";
import { and, desc, eq, isNull } from "drizzle-orm";

export interface WebhookDeps {
  db: Database;
  encryptionKey?: string;
  queue?: Queue<WebhookDeliveryJob>;
  tenantId: string;
}

export class WebhookServiceError extends Error {
  readonly status: 400 | 404 | 409 | 503;

  constructor(message: string, status: 400 | 404 | 409 | 503) {
    super(message);
    this.status = status;
  }
}

function requireEncryptionKey(deps: WebhookDeps) {
  if (!deps.encryptionKey) {
    throw new WebhookServiceError(
      "Configure PROVIDER_KEYS_ENCRYPTION_KEY before saving webhook endpoints",
      503
    );
  }
  return deps.encryptionKey;
}

export function listWebhookEndpoints(deps: WebhookDeps) {
  return deps.db
    .select({
      createdAt: webhookEndpoints.createdAt,
      deletedAt: webhookEndpoints.deletedAt,
      enabled: webhookEndpoints.enabled,
      events: webhookEndpoints.events,
      id: webhookEndpoints.id,
      name: webhookEndpoints.name,
      updatedAt: webhookEndpoints.updatedAt,
      url: webhookEndpoints.url,
    })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, deps.tenantId))
    .orderBy(desc(webhookEndpoints.createdAt));
}

export async function getWebhookEndpoint(deps: WebhookDeps, endpointId: string) {
  const [endpoint] = await deps.db
    .select({
      createdAt: webhookEndpoints.createdAt,
      deletedAt: webhookEndpoints.deletedAt,
      enabled: webhookEndpoints.enabled,
      events: webhookEndpoints.events,
      id: webhookEndpoints.id,
      name: webhookEndpoints.name,
      updatedAt: webhookEndpoints.updatedAt,
      url: webhookEndpoints.url,
    })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.tenantId, deps.tenantId)))
    .limit(1);
  if (!endpoint) {
    throw new WebhookServiceError("Webhook endpoint not found", 404);
  }
  return endpoint;
}

export async function createWebhookEndpoint(deps: WebhookDeps, rawInput: unknown) {
  const input = webhookEndpointCreateSchema.parse(rawInput);
  const secret = randomBytes(32).toString("base64url");
  const [endpoint] = await deps.db
    .insert(webhookEndpoints)
    .values({
      ...input,
      encryptedSecret: encryptProviderCredential(secret, requireEncryptionKey(deps)),
      tenantId: deps.tenantId,
    })
    .returning({
      createdAt: webhookEndpoints.createdAt,
      deletedAt: webhookEndpoints.deletedAt,
      enabled: webhookEndpoints.enabled,
      events: webhookEndpoints.events,
      id: webhookEndpoints.id,
      name: webhookEndpoints.name,
      updatedAt: webhookEndpoints.updatedAt,
      url: webhookEndpoints.url,
    });
  return { ...endpoint, secret };
}

export async function updateWebhookEndpoint(
  deps: WebhookDeps,
  endpointId: string,
  rawInput: unknown
) {
  const input = webhookEndpointUpdateSchema.parse(rawInput);
  const [endpoint] = await deps.db
    .update(webhookEndpoints)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.tenantId, deps.tenantId),
        isNull(webhookEndpoints.deletedAt)
      )
    )
    .returning({
      createdAt: webhookEndpoints.createdAt,
      deletedAt: webhookEndpoints.deletedAt,
      enabled: webhookEndpoints.enabled,
      events: webhookEndpoints.events,
      id: webhookEndpoints.id,
      name: webhookEndpoints.name,
      updatedAt: webhookEndpoints.updatedAt,
      url: webhookEndpoints.url,
    });
  if (!endpoint) {
    throw new WebhookServiceError("Webhook endpoint not found", 404);
  }
  return endpoint;
}

export async function deleteWebhookEndpoint(deps: WebhookDeps, endpointId: string) {
  const [endpoint] = await deps.db
    .update(webhookEndpoints)
    .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.tenantId, deps.tenantId),
        isNull(webhookEndpoints.deletedAt)
      )
    )
    .returning({ id: webhookEndpoints.id });
  if (!endpoint) {
    throw new WebhookServiceError("Webhook endpoint not found", 404);
  }
}

export async function listWebhookDeliveries(
  deps: WebhookDeps,
  endpointId: string,
  limit = 50,
  offset = 0
) {
  const [endpoint] = await deps.db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.tenantId, deps.tenantId)))
    .limit(1);
  if (!endpoint) {
    throw new WebhookServiceError("Webhook endpoint not found", 404);
  }
  return deps.db
    .select({
      attemptCount: webhookDeliveries.attemptCount,
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      eventId: webhookDeliveries.eventId,
      eventType: webhookDeliveries.eventType,
      id: webhookDeliveries.id,
      lastError: webhookDeliveries.lastError,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      payload: webhookDeliveries.payload,
      replayCount: webhookDeliveries.replayCount,
      responseBody: webhookDeliveries.responseBody,
      responseStatus: webhookDeliveries.responseStatus,
      status: webhookDeliveries.status,
    })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.endpointId, endpointId),
        eq(webhookDeliveries.tenantId, deps.tenantId)
      )
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function replayWebhookDelivery(
  deps: WebhookDeps,
  endpointId: string,
  deliveryId: string
) {
  const { queue } = deps;
  if (!queue) {
    throw new WebhookServiceError("Webhook delivery queue is unavailable", 503);
  }
  const replay = await deps.db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({
        attemptCount: webhookDeliveries.attemptCount,
        deliveredAt: webhookDeliveries.deliveredAt,
        endpointId: webhookDeliveries.endpointId,
        lastError: webhookDeliveries.lastError,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        replayCount: webhookDeliveries.replayCount,
        responseBody: webhookDeliveries.responseBody,
        responseStatus: webhookDeliveries.responseStatus,
        status: webhookDeliveries.status,
      })
      .from(webhookDeliveries)
      .innerJoin(
        webhookEndpoints,
        and(
          eq(webhookEndpoints.id, webhookDeliveries.endpointId),
          eq(webhookEndpoints.tenantId, webhookDeliveries.tenantId)
        )
      )
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.tenantId, deps.tenantId),
          eq(webhookEndpoints.tenantId, deps.tenantId),
          eq(webhookEndpoints.enabled, true),
          isNull(webhookEndpoints.deletedAt)
        )
      )
      .for("update");
    if (!delivery) {
      throw new WebhookServiceError("Webhook delivery not found", 404);
    }
    if (delivery.status === "pending") {
      throw new WebhookServiceError("Webhook delivery is already pending", 409);
    }
    const nextReplayCount = delivery.replayCount + 1;
    await tx
      .update(webhookDeliveries)
      .set({
        attemptCount: 0,
        deliveredAt: null,
        lastError: null,
        nextAttemptAt: null,
        replayCount: nextReplayCount,
        responseBody: null,
        responseStatus: null,
        status: "pending",
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return {
      previous: delivery,
      replayCount: nextReplayCount,
    };
  });

  try {
    await queue.add(
      "deliver",
      { deliveryId, replay: replay.replayCount },
      {
        attempts: 5,
        backoff: { delay: 5000, type: "exponential" },
        jobId: `${deliveryId}_r${replay.replayCount}`,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      }
    );
  } catch (error) {
    await deps.db
      .update(webhookDeliveries)
      .set({
        attemptCount: replay.previous.attemptCount,
        deliveredAt: replay.previous.deliveredAt,
        lastError: replay.previous.lastError,
        nextAttemptAt: replay.previous.nextAttemptAt,
        replayCount: replay.previous.replayCount,
        responseBody: replay.previous.responseBody,
        responseStatus: replay.previous.responseStatus,
        status: replay.previous.status,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    throw error;
  }
  return { deliveryId, replayCount: replay.replayCount, status: "pending" as const };
}
