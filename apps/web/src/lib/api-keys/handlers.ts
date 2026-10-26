import { z } from "zod";
import {
  DashboardAuthError,
  DashboardForbiddenError,
  dashboardErrorResponse,
} from "@/lib/dashboard/errors";
import type { WorkspaceDeps } from "@/lib/workspaces/service";
import { WorkspaceBadRequestError } from "@/lib/workspaces/service";
import { ApiKeyNotFoundError, createApiKey, listApiKeys, revokeApiKey } from "./service";

const noStore = { "Cache-Control": "no-store" };

function trustedOrigin(request: Request, expectedOrigin: string) {
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    request.headers.get("origin") !== new URL(expectedOrigin).origin
  ) {
    throw new DashboardForbiddenError("Cross-origin requests are not allowed");
  }
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    throw new WorkspaceBadRequestError("Request body must be JSON", { cause: error });
  }
}

export function createApiKeyHandlers(
  getDeps: () => Promise<WorkspaceDeps>,
  expectedOrigin: string
) {
  return {
    async create(request: Request, tenantId: string) {
      try {
        trustedOrigin(request, expectedOrigin);
        const result = await createApiKey(await getDeps(), tenantId, await readJson(request));
        return Response.json(result, { headers: noStore, status: 201 });
      } catch (error) {
        return apiKeyErrorResponse(error);
      }
    },
    async list(tenantId: string) {
      try {
        const keys = await listApiKeys(await getDeps(), tenantId);
        return Response.json({ keys }, { headers: noStore });
      } catch (error) {
        return apiKeyErrorResponse(error);
      }
    },
    async revoke(request: Request, tenantId: string, keyId: string) {
      try {
        trustedOrigin(request, expectedOrigin);
        await revokeApiKey(await getDeps(), tenantId, keyId);
        return new Response(null, { headers: noStore, status: 204 });
      } catch (error) {
        return apiKeyErrorResponse(error);
      }
    },
  };
}

function apiKeyErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request" },
      { headers: noStore, status: 400 }
    );
  }
  if (error instanceof WorkspaceBadRequestError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 400 });
  }
  if (error instanceof ApiKeyNotFoundError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 404 });
  }
  if (error instanceof DashboardAuthError || error instanceof DashboardForbiddenError) {
    return dashboardErrorResponse(error);
  }
  console.error({
    errorType: error instanceof Error ? error.name : typeof error,
    event: "api_key.request.failed",
  });
  return Response.json({ error: "Internal server error" }, { headers: noStore, status: 500 });
}
