import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { parse } from "dotenv";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { initializeAuthEnvironment, initializeFirstAdmin, parseAdminEnvironment } from "./admin.ts";
import { createDb } from "./client.ts";
import { accounts, sessions, users, verifications } from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;
const skipDatabase = databaseUrl ? false : "DATABASE_URL not set";

test("admin environment accepts a blank stored auth secret and preserves other settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "answerline-admin-"));
  const path = join(directory, ".env");
  try {
    await writeFile(path, "KEEP_ME=value\nBETTER_AUTH_SECRET=\nBETTER_AUTH_URL=\n");
    const environment = parseAdminEnvironment({
      BETTER_AUTH_SECRET: "",
      DATABASE_URL: "postgres://answerline:answerline@localhost:5432/answerline",
      PORT: "3013",
    });
    const result = await initializeAuthEnvironment(path, environment);
    const contents = await readFile(path, "utf8");
    const lines = contents.split("\n");
    assert.ok(lines.includes("KEEP_ME=value"));
    assert.ok(lines.some((line) => line.startsWith("BETTER_AUTH_SECRET=") && line.length > 19));
    assert.ok(lines.includes("BETTER_AUTH_URL=http://localhost:3013"));
    assert.equal(result.baseURL, "http://localhost:3013");
    assert.ok(result.secret.length >= 32);
    assert.equal((await stat(path)).mode.toString(8).slice(-3), "600");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("admin init creates one usable administrator and leaves it unchanged on rerun", {
  skip: skipDatabase,
}, async () => {
  const databaseName = `answerline_admin_${crypto.randomUUID().replaceAll("-", "")}`;
  const rootClient = postgres(databaseUrl as string, { max: 1 });
  const directory = await mkdtemp(join(tmpdir(), "answerline-admin-integration-"));
  const envPath = join(directory, ".env");
  const credentialsPath = join(directory, "admin-credentials");
  let db: ReturnType<typeof createDb> | undefined;
  let databaseCreated = false;

  try {
    await rootClient.unsafe(`create database "${databaseName}"`);
    databaseCreated = true;
    const isolatedUrl = new URL(databaseUrl as string);
    isolatedUrl.pathname = `/${databaseName}`;
    const isolatedDb = createDb(isolatedUrl.toString());
    db = isolatedDb;
    await migrate(isolatedDb, {
      migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    });

    const email = `admin-${crypto.randomUUID()}@example.com`;
    const environment = parseAdminEnvironment({
      ADMIN_EMAIL: email,
      DATABASE_URL: isolatedUrl.toString(),
      PORT: "3013",
    });
    const initialize = () =>
      initializeFirstAdmin({ credentialsPath, db: isolatedDb, environment, envPath });
    const results = await Promise.all([initialize(), initialize()]);
    assert.equal(results.filter((result) => result.created).length, 1);

    const [user] = await isolatedDb.select().from(users).where(eq(users.email, email));
    assert.ok(user);
    assert.equal(user.emailVerified, false);
    assert.equal((await isolatedDb.select().from(users)).length, 1);
    const [account] = await isolatedDb.select().from(accounts).where(eq(accounts.userId, user.id));
    assert.ok(account?.password);
    assert.notEqual(account.password, "");
    assert.equal(account.providerId, "credential");
    assert.equal(account.accountId, user.id);

    const credentials = await readFile(credentialsPath, "utf8");
    assert.equal((await stat(credentialsPath)).mode.toString(8).slice(-3), "600");
    const password = credentials
      .split("\n")
      .find((line) => line.startsWith("Password: "))
      ?.slice(10);
    assert.ok(password);

    const authEnvironment = parse(await readFile(envPath, "utf8"));
    const auth = betterAuth({
      advanced: { database: { generateId: "uuid" } },
      baseURL: authEnvironment.BETTER_AUTH_URL,
      database: drizzleAdapter(isolatedDb, {
        provider: "pg",
        schema: { account: accounts, session: sessions, user: users, verification: verifications },
        transaction: true,
      }),
      emailAndPassword: { enabled: true },
      logger: { disabled: true },
      secret: authEnvironment.BETTER_AUTH_SECRET,
    });
    const signedIn = await auth.api.signInEmail({ body: { email, password } });
    assert.equal(signedIn.user.id, user.id);

    const changedEnvironment = parseAdminEnvironment({
      ADMIN_EMAIL: `replacement-${crypto.randomUUID()}@example.com`,
      ADMIN_PASSWORD: "replacement-password-that-must-not-be-applied",
      DATABASE_URL: isolatedUrl.toString(),
    });
    assert.deepEqual(
      await initializeFirstAdmin({
        credentialsPath,
        db: isolatedDb,
        environment: changedEnvironment,
        envPath,
      }),
      { created: false }
    );
    assert.equal((await isolatedDb.select().from(users)).length, 1);
    assert.deepEqual(await isolatedDb.select().from(users).where(eq(users.id, user.id)), [user]);
    assert.deepEqual(await isolatedDb.select().from(accounts).where(eq(accounts.userId, user.id)), [
      account,
    ]);
    assert.equal(await readFile(credentialsPath, "utf8"), credentials);
  } finally {
    if (db) {
      await db.$client.end();
    }
    if (databaseCreated) {
      await rootClient.unsafe(`drop database "${databaseName}" with (force)`);
    }
    await rootClient.end();
    await rm(directory, { force: true, recursive: true });
  }
});
