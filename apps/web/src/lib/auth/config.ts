import { accounts, type Database, sessions, users, verifications } from "@answerline/db";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { z } from "zod";

export const authConfigSchema = z.object({
  baseURL: z.url({ protocol: /^https?$/ }),
  github: z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) }).optional(),
  secret: z.string().min(32),
});

export function createAuth(db: Database, config: z.infer<typeof authConfigSchema>) {
  return betterAuth({
    account: { accountLinking: { enabled: true, trustedProviders: [] } },
    advanced: { database: { generateId: "uuid" } },
    appName: "Answerline",
    baseURL: config.baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { account: accounts, session: sessions, user: users, verification: verifications },
      transaction: true,
    }),
    emailAndPassword: { disableSignUp: true, enabled: true },
    secret: config.secret,
    session: { cookieCache: { enabled: false } },
    socialProviders: config.github
      ? {
          github: {
            clientId: config.github.clientId,
            clientSecret: config.github.clientSecret,
            disableSignUp: true,
          },
        }
      : {},
  });
}
