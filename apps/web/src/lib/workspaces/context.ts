import { env } from "@/env";
import { getSessionContext } from "@/lib/auth/context";
import { getAuthRuntime } from "@/lib/auth/server";
import { createWorkspaceHandlers } from "./handlers";

export const workspaceHandlers = createWorkspaceHandlers(getSessionContext, () => ({
  db: getAuthRuntime().db,
  trustedOrigin: new URL(env.BETTER_AUTH_URL).origin,
}));
