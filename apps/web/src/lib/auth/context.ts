import { headers } from "next/headers";
import { cache } from "react";
import { DashboardAuthError } from "@/lib/dashboard/errors";
import { getAuthRuntime } from "./server";

export const getSessionContext = cache(async () => {
  const requestHeaders = await headers();
  if (!requestHeaders.get("cookie")) {
    throw new DashboardAuthError();
  }
  const { auth, db } = getAuthRuntime();
  const authenticated = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableRefresh: true },
  });
  if (!authenticated) {
    throw new DashboardAuthError();
  }
  return { db, session: authenticated.session, user: authenticated.user };
});
