import { env } from "@/env";
import { getSessionContext } from "@/lib/auth/context";
import { createProviderKeyHandlers } from "./handlers";

export const providerKeyHandlers = createProviderKeyHandlers(
  getSessionContext,
  new URL(env.BETTER_AUTH_URL).origin
);
