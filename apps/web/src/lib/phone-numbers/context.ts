import { agents, createDb, type Database, tenants } from "@answerline/db";
import { createPhoneNumberClient } from "@answerline/worker/phone-numbers";
import { asc, eq } from "drizzle-orm";
import { env } from "@/env";
import type { PhoneNumberDeps } from "./service";

const globalForPhoneNumbers = globalThis as typeof globalThis & {
  phoneNumbersDb?: Database;
};

function database() {
  if (!globalForPhoneNumbers.phoneNumbersDb) {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for phone numbers");
    }
    globalForPhoneNumbers.phoneNumbersDb = createDb(env.DATABASE_URL);
  }
  return globalForPhoneNumbers.phoneNumbersDb;
}

export function getPhoneNumberDeps(): Promise<PhoneNumberDeps> {
  const db = database();
  return Promise.resolve({
    agentName: env.AGENT_NAME,
    client: createPhoneNumberClient(env),
    listAgents: async () => {
      const [tenant] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, env.TENANT));
      if (!tenant) {
        throw new Error(`Tenant "${env.TENANT}" not found; run pnpm db:seed`);
      }
      return db
        .select({ name: agents.name, slug: agents.slug })
        .from(agents)
        .where(eq(agents.tenantId, tenant.id))
        .orderBy(asc(agents.name), asc(agents.slug));
    },
  });
}
