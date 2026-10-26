import type { Database } from "@answerline/db";
import type { ApiKeyScope } from "@answerline/shared";
import { headers } from "next/headers";
import { env } from "@/env";
import { getSessionContext } from "@/lib/auth/context";
import { getAuthRuntime } from "@/lib/auth/server";
import { getDashboardContext } from "@/lib/dashboard/context";
import { DashboardAuthError } from "@/lib/dashboard/errors";
import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/workspaces/permissions";
import { createApiKeyHandlers } from "./handlers";
import { authenticateApiKey, requireApiKeyScope } from "./service";

const bearerTokenPattern = /^Bearer\s+(\S+)$/i;

export async function resolveApiKeyContext(
  db: Database,
  authorization: string,
  scope: ApiKeyScope
) {
  const token = bearerTokenPattern.exec(authorization)?.[1];
  if (!token) {
    throw new DashboardAuthError();
  }
  const key = await authenticateApiKey(db, token);
  if (!key) {
    throw new DashboardAuthError();
  }
  requireApiKeyScope(key.scopes, scope);
  return { db, tenantId: key.tenantId };
}

export async function getWorkspaceApiContext(scope: ApiKeyScope, access: WorkspaceAccess) {
  const requestHeaders = await headers();
  if (requestHeaders.has("authorization")) {
    return resolveApiKeyContext(
      getAuthRuntime().db,
      requestHeaders.get("authorization") ?? "",
      scope
    );
  }
  const context = await getDashboardContext();
  requireWorkspaceAccess(context.role, access);
  return { db: context.db, tenantId: context.tenantId };
}

export const apiKeyHandlers = createApiKeyHandlers(
  getSessionContext,
  new URL(env.BETTER_AUTH_URL).origin
);
