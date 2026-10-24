import { tenants } from "@answerline/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { env } from "@/env";
import { getAuthRuntime } from "@/lib/auth/server";
import { DashboardAuthError } from "./errors";

export const getDashboardContext = cache(async () => {
  const requestHeaders = await headers();
  if (!requestHeaders.get("cookie")) {
    throw new DashboardAuthError();
  }
  const { auth, db } = getAuthRuntime();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    throw new DashboardAuthError();
  }
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, env.TENANT));
  if (!tenant) {
    throw new Error(`Tenant "${env.TENANT}" not found; run pnpm db:seed`);
  }
  return { db, tenantId: tenant.id, user: session.user };
});
