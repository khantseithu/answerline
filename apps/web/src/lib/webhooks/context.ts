import type { WebhookDeliveryJob } from "@answerline/shared";
import { QUEUES } from "@answerline/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@/env";
import { getDashboardContext } from "@/lib/dashboard/context";
import { requireWorkspaceOwner } from "@/lib/workspaces/permissions";
import { createWebhookHandlers } from "./handlers";
import type { WebhookDeps } from "./service";

interface WebhookRuntime {
  queue: Queue<WebhookDeliveryJob>;
}

const globalForWebhooks = globalThis as typeof globalThis & {
  webhookRuntime?: WebhookRuntime;
};

function runtime() {
  if (!globalForWebhooks.webhookRuntime) {
    globalForWebhooks.webhookRuntime = {
      queue: new Queue<WebhookDeliveryJob>(QUEUES.webhookDeliveries, {
        connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 }),
        prefix: env.REDIS_PREFIX,
      }),
    };
  }
  return globalForWebhooks.webhookRuntime;
}

export async function getWebhookDeps(queueRequired = false): Promise<WebhookDeps> {
  const context = await getDashboardContext();
  requireWorkspaceOwner(context.role);
  return {
    db: context.db,
    encryptionKey: env.PROVIDER_KEYS_ENCRYPTION_KEY,
    queue: queueRequired ? runtime().queue : undefined,
    tenantId: context.tenantId,
  };
}

export const webhookHandlers = createWebhookHandlers(getWebhookDeps);
