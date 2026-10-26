import { env } from "@/env";
import { getSessionContext } from "@/lib/auth/context";
import { createApiKeyHandlers } from "./handlers";

export const apiKeyHandlers = createApiKeyHandlers(
  getSessionContext,
  new URL(env.BETTER_AUTH_URL).origin
);
