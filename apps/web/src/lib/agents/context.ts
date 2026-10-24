import { getDashboardContext } from "@/lib/dashboard/context";
import type { AgentDeps } from "./service";

export async function getAgentDeps(): Promise<AgentDeps> {
  const { db, tenantId } = await getDashboardContext();
  return { db, tenantId };
}
