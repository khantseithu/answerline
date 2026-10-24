import { createDb } from "@answerline/db";
import { env } from "@/env";
import { authConfigSchema, createAuth } from "./config";

let runtime: { auth: ReturnType<typeof createAuth>; db: ReturnType<typeof createDb> } | undefined;

export function getAuthRuntime() {
  if (!runtime) {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for authentication");
    }
    const config = authConfigSchema.parse({
      baseURL: env.BETTER_AUTH_URL,
      github:
        env.AUTH_GITHUB_CLIENT_ID && env.AUTH_GITHUB_CLIENT_SECRET
          ? { clientId: env.AUTH_GITHUB_CLIENT_ID, clientSecret: env.AUTH_GITHUB_CLIENT_SECRET }
          : undefined,
      secret: env.BETTER_AUTH_SECRET,
    });
    const db = createDb(env.DATABASE_URL);
    runtime = { auth: createAuth(db, config), db };
  }
  return runtime;
}

export function getAuth() {
  return getAuthRuntime().auth;
}
