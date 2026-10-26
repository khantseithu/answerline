import { providerCredentialProviderSchema, setProviderCredentialSchema } from "@answerline/shared";
import { z } from "zod";
import {
  DashboardAuthError,
  DashboardForbiddenError,
  dashboardErrorResponse,
} from "@/lib/dashboard/errors";
import { WorkspaceBadRequestError, type WorkspaceDeps } from "@/lib/workspaces/service";
import {
  deleteProviderCredential,
  deploymentProviderKey,
  listProviderCredentials,
  ProviderCredentialEncryptionUnavailableError,
  setProviderCredential,
} from "./service";

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
  } catch (cause) {
    throw new WorkspaceBadRequestError("Request body must be JSON", { cause });
  }
}

export function createProviderKeyHandlers(
  getDeps: () => Promise<WorkspaceDeps>,
  expectedOrigin: string
) {
  return {
    async list(tenantId: string) {
      try {
        const credentials = await listProviderCredentials(await getDeps(), tenantId);
        return Response.json(
          {
            providers: providerCredentialProviderSchema.options.map((provider) => ({
              hasDeploymentKey: Boolean(deploymentProviderKey(provider)),
              hasWorkspaceKey: credentials.some((credential) => credential.provider === provider),
              provider,
            })),
          },
          { headers: noStore }
        );
      } catch (error) {
        return providerKeyErrorResponse(error);
      }
    },
    async remove(request: Request, tenantId: string, rawProvider: string) {
      try {
        trustedOrigin(request, expectedOrigin);
        await deleteProviderCredential(await getDeps(), tenantId, rawProvider);
        return new Response(null, { headers: noStore, status: 204 });
      } catch (error) {
        return providerKeyErrorResponse(error);
      }
    },
    async set(request: Request, tenantId: string) {
      try {
        trustedOrigin(request, expectedOrigin);
        const input = setProviderCredentialSchema.parse(await readJson(request));
        await setProviderCredential(await getDeps(), tenantId, input);
        return new Response(null, { headers: noStore, status: 204 });
      } catch (error) {
        return providerKeyErrorResponse(error);
      }
    },
  };
}

function providerKeyErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request" },
      { headers: noStore, status: 400 }
    );
  }
  if (error instanceof WorkspaceBadRequestError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 400 });
  }
  if (error instanceof ProviderCredentialEncryptionUnavailableError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 503 });
  }
  if (error instanceof DashboardAuthError || error instanceof DashboardForbiddenError) {
    return dashboardErrorResponse(error);
  }
  console.error({
    errorType: error instanceof Error ? error.name : typeof error,
    event: "provider_key.request.failed",
  });
  return Response.json({ error: "Internal server error" }, { headers: noStore, status: 500 });
}
