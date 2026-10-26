import { getWorkspaceApiContext } from "@/lib/api-keys/context";
import type { WorkspaceAccess } from "@/lib/workspaces/permissions";
export function getAgentDeps(access: WorkspaceAccess = "read") {
  const scope = access === "read" ? "agents:read" : "agents:write";
  return getWorkspaceApiContext(scope, access);
}
