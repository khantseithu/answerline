import { z } from "zod";
import { env } from "@/env";
import { DashboardForbiddenError, dashboardErrorResponse } from "@/lib/dashboard/errors";
import type { WebhookDeps } from "./service";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  replayWebhookDelivery,
  updateWebhookEndpoint,
  WebhookServiceError,
} from "./service";

const noStore = { "Cache-Control": "no-store" };
const positiveInt = z.coerce.number().int().min(1);
const nonnegativeInt = z.coerce.number().int().nonnegative();

export function createWebhookHandlers(getDeps: (queueRequired?: boolean) => Promise<WebhookDeps>) {
  async function respond(operation: () => Promise<unknown>, status = 200) {
    try {
      return Response.json(await operation(), { headers: noStore, status });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: error.issues[0]?.message ?? "Invalid request" },
          { headers: noStore, status: 400 }
        );
      }
      if (error instanceof WebhookServiceError) {
        return Response.json({ error: error.message }, { headers: noStore, status: error.status });
      }
      if (error instanceof Error && error.name === "WebhookBadRequestError") {
        return Response.json({ error: error.message }, { headers: noStore, status: 400 });
      }
      return dashboardErrorResponse(error);
    }
  }

  function requireTrustedOrigin(request: Request) {
    const expectedOrigin = new URL(env.BETTER_AUTH_URL).origin;
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      request.headers.get("origin") !== expectedOrigin
    ) {
      throw new DashboardForbiddenError("Cross-origin requests are not allowed");
    }
  }

  async function readBody(request: Request) {
    requireTrustedOrigin(request);
    try {
      return await request.json();
    } catch (error) {
      const invalidJson = new Error("Request body must be JSON", { cause: error });
      invalidJson.name = "WebhookBadRequestError";
      throw invalidJson;
    }
  }

  return {
    create: (request: Request) =>
      respond(async () => {
        const input = await readBody(request);
        return createWebhookEndpoint(await getDeps(), input);
      }, 201),
    delete: (request: Request, endpointId: string) =>
      respond(async () => {
        requireTrustedOrigin(request);
        await deleteWebhookEndpoint(await getDeps(), endpointId);
        return { id: endpointId };
      }),
    deliveries: (request: Request, endpointId: string) =>
      respond(async () => {
        const url = new URL(request.url);
        const limit = positiveInt.max(100).default(50).parse(url.searchParams.get("limit"));
        const offset = nonnegativeInt.default(0).parse(url.searchParams.get("offset"));
        return {
          deliveries: await listWebhookDeliveries(await getDeps(), endpointId, limit, offset),
        };
      }),
    get: (_request: Request, endpointId: string) =>
      respond(async () => getWebhookEndpoint(await getDeps(), endpointId)),
    list: () => respond(async () => ({ endpoints: await listWebhookEndpoints(await getDeps()) })),
    replay: (request: Request, endpointId: string, deliveryId: string) =>
      respond(async () => {
        requireTrustedOrigin(request);
        return replayWebhookDelivery(await getDeps(true), endpointId, deliveryId);
      }, 202),
    update: (request: Request, endpointId: string) =>
      respond(async () => {
        const input = await readBody(request);
        return updateWebhookEndpoint(await getDeps(), endpointId, input);
      }),
  };
}
