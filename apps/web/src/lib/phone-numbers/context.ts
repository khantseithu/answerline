import { agents } from "@answerline/db";
import { createPhoneNumberClient } from "@answerline/worker/phone-numbers";
import { asc, eq } from "drizzle-orm";
import { env } from "@/env";
import { getDashboardContext } from "@/lib/dashboard/context";
import type { PhoneNumberDeps } from "./service";

export async function getPhoneNumberDeps(): Promise<PhoneNumberDeps> {
  const { db, tenantId } = await getDashboardContext();
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
