import { agents, tenants } from "@answerline/db";
import { createPhoneNumberClient } from "@answerline/worker/phone-numbers";
import { asc, eq } from "drizzle-orm";
import { env } from "@/env";
import { getDashboardContext } from "@/lib/dashboard/context";
import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/workspaces/permissions";
import type { PhoneNumberDeps } from "./service";

<<<<<<< HEAD
export async function getPhoneNumberDeps(
  access: WorkspaceAccess = "read"
): Promise<PhoneNumberDeps> {
  const { db, role, tenantId } = await getDashboardContext();
  requireWorkspaceAccess(role, access);
  const [workspace] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  return {
    agentName: env.AGENT_NAME,
    client: createPhoneNumberClient(env),
    legacyTenant: env.TENANT,
    listAgents: () =>
      db
        .select({ name: agents.name, slug: agents.slug })
        .from(agents)
        .where(eq(agents.tenantId, tenantId))
        .orderBy(asc(agents.name), asc(agents.slug)),
    tenant: workspace.slug,
  };
}
