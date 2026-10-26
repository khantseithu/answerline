import { cache } from "react";
import { getSessionContext } from "@/lib/auth/context";
import { resolveActiveWorkspace } from "@/lib/workspaces/service";

export const getDashboardContext = cache(async () => {
  const context = await getSessionContext();
  const workspace = await resolveActiveWorkspace(context);
  return { ...context, role: workspace.role, tenantId: workspace.id, workspace };
});
