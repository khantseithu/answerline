import type { WorkspaceRole } from "@answerline/shared";
import { DashboardForbiddenError } from "@/lib/dashboard/errors";

export type WorkspaceAccess = "read" | "write";

export function requireWorkspaceAccess(role: WorkspaceRole, access: WorkspaceAccess = "read") {
  if (access === "write" && role === "viewer") {
    throw new DashboardForbiddenError("Viewers have read-only workspace access");
  }
}

export function requireWorkspaceOwner(role: WorkspaceRole) {
  if (role !== "owner") {
    throw new DashboardForbiddenError("Only workspace owners can manage members and settings");
  }
}
