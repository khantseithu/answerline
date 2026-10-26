import { agents } from "@answerline/db";
import { createPhoneNumberClient } from "@answerline/worker/phone-numbers";
import { asc, eq } from "drizzle-orm";
import { env } from "@/env";
import { getDashboardContext } from "@/lib/dashboard/context";
import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/workspaces/permissions";
import type { PhoneNumberDeps } from "./service";

export async function getPhoneNumberDeps(
  access: WorkspaceAccess = "read"
): Promise<PhoneNumberDeps> {
  const { db, role, tenantId } = await getDashboardContext();
  requireWorkspaceAccess(role, access);
  return {
    agentName: env.AGENT_NAME,
    client: createPhoneNumberClient(env),
    listAgents: () =>
      db
        .select({ name: agents.name, slug: agents.slug })
        .from(agents)
        .where(eq(agents.tenantId, tenantId))
        .orderBy(asc(agents.name), asc(agents.slug)),
  };
}
