import { getDashboardContext } from "@/lib/dashboard/context";
import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/workspaces/permissions";
import type { AgentDeps } from "./service";

export async function getAgentDeps(access: WorkspaceAccess = "read"): Promise<AgentDeps> {
  const { db, role, tenantId } = await getDashboardContext();
  requireWorkspaceAccess(role, access);
  return { db, tenantId };
}
