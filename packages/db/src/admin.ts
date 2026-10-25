import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspaceSlugSchema } from "@answerline/shared";
import { hashPassword } from "better-auth/crypto";
import { parse } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./client.ts";
import { accounts, tenants, users, workspaceMembers } from "./schema.ts";

const adminEnvironmentSchema = z.object({
  ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()).default("admin@answerline.local"),
  ADMIN_EMAIL_VERIFIED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.url().optional(),
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  TENANT: workspaceSlugSchema.default("default"),
});

export const parseAdminEnvironment = (source: NodeJS.ProcessEnv) =>
  adminEnvironmentSchema.parse({
    ...source,
    ADMIN_PASSWORD: source.ADMIN_PASSWORD || undefined,
    BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET || undefined,
    BETTER_AUTH_URL: source.BETTER_AUTH_URL || undefined,
  });

async function readEnvironmentFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function initializeAuthEnvironment(
  path: string,
  config: ReturnType<typeof parseAdminEnvironment>
) {
  const content = await readEnvironmentFile(path);
  const stored = parse(content);
  const secret =
    config.BETTER_AUTH_SECRET || stored.BETTER_AUTH_SECRET || randomBytes(48).toString("base64url");
  z.string().min(32).parse(secret);
  const url = config.BETTER_AUTH_URL || stored.BETTER_AUTH_URL || `http://localhost:${config.PORT}`;
  z.url().parse(url);
  const missing = [
    ...(config.BETTER_AUTH_SECRET || stored.BETTER_AUTH_SECRET
      ? []
      : [`BETTER_AUTH_SECRET=${secret}`]),
    ...(config.BETTER_AUTH_URL || stored.BETTER_AUTH_URL ? [] : [`BETTER_AUTH_URL=${url}`]),
  ];
  if (missing.length > 0) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${content}${content && !content.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`,
      { mode: 0o600 }
    );
    await chmod(path, 0o600);
  }
  return { baseURL: url, secret };
}

async function savePassword(path: string, email: string, password: string) {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const file = await open(path, "w", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(`Email: ${email}\nPassword: ${password}\n`);
  } finally {
    await file.close();
  }
}

export async function initializeFirstAdmin({
  db,
  environment,
  envPath,
  credentialsPath,
}: {
  db: Database;
  environment: ReturnType<typeof parseAdminEnvironment>;
  envPath: string;
  credentialsPath: string;
}) {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('answerline-first-admin'))`);
    await initializeAuthEnvironment(envPath, environment);
    const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing) {
      return { created: false as const };
    }
    const password = environment.ADMIN_PASSWORD ?? randomBytes(24).toString("base64url");
    const [user] = await tx
      .insert(users)
      .values({
        email: environment.ADMIN_EMAIL,
        emailVerified: environment.ADMIN_EMAIL_VERIFIED,
        name: "Administrator",
      })
      .returning();
    if (!user) {
      throw new Error("Could not create initial administrator");
    }
    await tx
      .insert(tenants)
      .values({ name: environment.TENANT, slug: environment.TENANT })
      .onConflictDoNothing();
    const [tenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, environment.TENANT));
    if (!tenant) {
      throw new Error("Could not resolve initial administrator workspace");
    }
    await tx.insert(workspaceMembers).values({
      role: "owner",
      tenantId: tenant.id,
      userId: user.id,
    });
    await tx.insert(accounts).values({
      accountId: user.id,
      password: await hashPassword(password),
      providerId: "credential",
      userId: user.id,
    });
    if (!environment.ADMIN_PASSWORD) {
      await savePassword(credentialsPath, user.email, password);
    }
    return {
      created: true as const,
      credentialsPath: environment.ADMIN_PASSWORD ? null : credentialsPath,
      email: user.email,
    };
  });
}
