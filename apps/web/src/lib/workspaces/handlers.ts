import type { Database } from "@answerline/db";
import { z } from "zod";
import {
  DashboardAuthError,
  DashboardForbiddenError,
  dashboardErrorResponse,
  WorkspaceRequiredError,
} from "@/lib/dashboard/errors";
import {
  acceptWorkspaceInvitation,
  createWorkspace,
  getWorkspaceInvitation,
  getWorkspaceSettings,
  inviteWorkspaceMember,
  listWorkspaces,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  signupWorkspaceInvitation,
  switchWorkspace,
  updateWorkspace,
  updateWorkspaceMember,
  WorkspaceBadRequestError,
  WorkspaceConflictError,
  type WorkspaceDeps,
  WorkspaceNotFoundError,
} from "./service";

const noStore = { "Cache-Control": "no-store" };

export function workspaceErrorResponse(error: unknown) {
  if (error instanceof z.ZodError || error instanceof WorkspaceBadRequestError) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? (error.issues[0]?.message ?? "Invalid request")
            : error.message,
      },
      { headers: noStore, status: 400 }
    );
  }
  if (error instanceof WorkspaceConflictError || error instanceof WorkspaceNotFoundError) {
    return Response.json(
      { error: error.message },
      { headers: noStore, status: error instanceof WorkspaceConflictError ? 409 : 404 }
    );
  }
  if (
    error instanceof DashboardAuthError ||
    error instanceof DashboardForbiddenError ||
    error instanceof WorkspaceRequiredError
  ) {
    return dashboardErrorResponse(error);
  }
  console.error({
    errorType: error instanceof Error ? error.name : typeof error,
    event: "workspace.request.failed",
  });
  return Response.json({ error: "Internal server error" }, { headers: noStore, status: 500 });
}

async function readJson(request: Request, trustedOrigin: string, requireOrigin = false) {
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (requireOrigin && origin !== new URL(trustedOrigin).origin) ||
    (origin && origin !== new URL(trustedOrigin).origin)
  ) {
    throw new DashboardForbiddenError("Cross-origin requests are not allowed");
  }
  try {
    return await request.json();
  } catch (error) {
    throw new WorkspaceBadRequestError("Request body must be JSON", { cause: error });
  }
}

export function createWorkspaceHandlers(
  getDeps: () => Promise<WorkspaceDeps>,
  getPublicDeps: () => { db: Database; trustedOrigin: string }
) {
  async function respond(operation: () => Promise<unknown>, status = 200) {
    try {
      const body = await operation();
      return status === 204
        ? new Response(null, { headers: noStore, status })
        : Response.json(body, { headers: noStore, status });
    } catch (error) {
      return workspaceErrorResponse(error);
    }
  }
  function input(request: Request, requireOrigin = false) {
    return readJson(request, getPublicDeps().trustedOrigin, requireOrigin);
  }
  return {
    accept: (request: Request) =>
      respond(async () => acceptWorkspaceInvitation(await getDeps(), await input(request))),
    create: (request: Request) =>
      respond(async () => createWorkspace(await getDeps(), await input(request)), 201),
    invite: (request: Request, tenantId: string) =>
      respond(
        async () =>
          inviteWorkspaceMember(
            await getDeps(),
            tenantId,
            await input(request),
            getPublicDeps().trustedOrigin
          ),
        201
      ),
    list: () => respond(async () => ({ workspaces: await listWorkspaces(await getDeps()) })),
    member: (request: Request, tenantId: string, userId: string) =>
      respond(
        async () => updateWorkspaceMember(await getDeps(), tenantId, userId, await input(request)),
        204
      ),
    preview: (request: Request) =>
      respond(async () =>
        getWorkspaceInvitation(getPublicDeps().db, (await input(request, true)).token)
      ),
    removeMember: (tenantId: string, userId: string) =>
      respond(async () => removeWorkspaceMember(await getDeps(), tenantId, userId), 204),
    revoke: (tenantId: string, invitationId: string) =>
      respond(async () => revokeWorkspaceInvitation(await getDeps(), tenantId, invitationId), 204),
    settings: (tenantId: string) =>
      respond(async () => getWorkspaceSettings(await getDeps(), tenantId)),
    signup: (request: Request) =>
      respond(
        async () => signupWorkspaceInvitation(getPublicDeps().db, await input(request, true)),
        201
      ),
    switch: (request: Request) =>
      respond(async () => switchWorkspace(await getDeps(), await input(request))),
    update: (request: Request, tenantId: string) =>
      respond(async () => updateWorkspace(await getDeps(), tenantId, await input(request))),
  };
}
