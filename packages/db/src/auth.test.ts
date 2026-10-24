import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client.ts";
import { accounts, sessions, users, verifications } from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

function hasPostgresCode(error: unknown, code: string) {
  return (
    error instanceof Error &&
    error.cause instanceof postgres.PostgresError &&
    error.cause.code === code
  );
}

test("Better Auth can sign up, authenticate, and revoke a database session", { skip }, async () => {
  const db = createDb();
  const email = `auth-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();
  const auth = betterAuth({
    advanced: { database: { generateId: "uuid" } },
    baseURL: "http://localhost:3000",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { account: accounts, session: sessions, user: users, verification: verifications },
      transaction: true,
    }),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    secret: crypto.randomUUID(),
  });
  try {
    const signedUp = await auth.api.signUpEmail({ body: { email, name: "Test Admin", password } });
    const [account] = await db.select().from(accounts).where(eq(accounts.userId, signedUp.user.id));
    assert.ok(account?.password);
    assert.notEqual(account.password, password);
    assert.equal(account.providerId, "credential");
    assert.equal(account.accountId, signedUp.user.id);
    assert.equal(account.accessToken, null);
    await assert.rejects(
      auth.api.signInEmail({ body: { email, password: crypto.randomUUID() } }),
      (error: unknown) => error instanceof APIError && error.statusCode === 401
    );
    const response = await auth.api.signInEmail({ asResponse: true, body: { email, password } });
    assert.equal(response.status, 200);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.ok(cookie);
    const headers = new Headers({ cookie });
    const session = await auth.api.getSession({ headers });
    assert.equal(session?.user.id, signedUp.user.id);
    assert.ok(session && session.session.expiresAt > new Date());
    await auth.api.signOut({ headers });
    assert.equal(await auth.api.getSession({ headers }), null);
  } finally {
    await db.delete(users).where(eq(users.email, email));
    await db.$client.end();
  }
});

test("auth records enforce identity uniqueness and cascade only the deleted user", {
  skip,
}, async () => {
  const db = createDb();
  const prefix = `auth-${crypto.randomUUID()}`;
  const emails = [`${prefix}-one@example.com`, `${prefix}-two@example.com`];
  const expiresAt = new Date("2030-01-01T12:00:00Z");
  try {
    const [first, second] = await db
      .insert(users)
      .values(emails.map((email) => ({ email, name: "Test User" })))
      .returning();
    assert.ok(first && second);
    assert.equal(first.emailVerified, false);
    assert.equal(first.image, null);
    await assert.rejects(
      db.insert(users).values({ email: first.email, name: "Duplicate" }),
      (error: unknown) => hasPostgresCode(error, "23505")
    );
    const account = {
      accessToken: crypto.randomUUID(),
      accessTokenExpiresAt: expiresAt,
      accountId: prefix,
      idToken: crypto.randomUUID(),
      providerId: "github",
      refreshToken: crypto.randomUUID(),
      refreshTokenExpiresAt: expiresAt,
      scope: "read:user",
      userId: first.id,
    };
    const [stored] = await db.insert(accounts).values(account).returning();
    assert.ok(stored);
    assert.equal(stored.password, null);
    assert.deepEqual(stored.accessTokenExpiresAt, expiresAt);
    assert.deepEqual(stored.refreshTokenExpiresAt, expiresAt);
    assert.equal(stored.refreshToken, account.refreshToken);
    assert.equal(stored.idToken, account.idToken);
    await assert.rejects(
      db.insert(accounts).values({ ...account, userId: second.id }),
      (error: unknown) => hasPostgresCode(error, "23505")
    );
    await db
      .insert(accounts)
      .values({ accountId: prefix, providerId: "google", userId: second.id });
    const token = crypto.randomUUID();
    await db.insert(sessions).values([
      { expiresAt, token, userId: first.id },
      { expiresAt, token: crypto.randomUUID(), userId: second.id },
    ]);
    await assert.rejects(
      db.insert(sessions).values({ expiresAt, token, userId: second.id }),
      (error: unknown) => hasPostgresCode(error, "23505")
    );
    const [verification] = await db
      .insert(verifications)
      .values({ expiresAt, identifier: prefix, value: crypto.randomUUID() })
      .returning();
    assert.ok(verification);
    assert.deepEqual(verification.expiresAt, expiresAt);
    await db
      .insert(verifications)
      .values({ expiresAt, identifier: prefix, value: crypto.randomUUID() });
    await db.delete(users).where(eq(users.id, first.id));
    assert.deepEqual(await db.select().from(accounts).where(eq(accounts.userId, first.id)), []);
    assert.deepEqual(await db.select().from(sessions).where(eq(sessions.userId, first.id)), []);
    assert.equal(
      (await db.select().from(accounts).where(eq(accounts.userId, second.id))).length,
      1
    );
    assert.equal(
      (await db.select().from(sessions).where(eq(sessions.userId, second.id))).length,
      1
    );
    assert.equal(
      (await db.select().from(verifications).where(eq(verifications.identifier, prefix))).length,
      2
    );
    const orphanId = crypto.randomUUID();
    await assert.rejects(
      db.insert(accounts).values({ accountId: prefix, providerId: "orphan", userId: orphanId }),
      (error: unknown) => hasPostgresCode(error, "23503")
    );
    await assert.rejects(
      db.insert(sessions).values({ expiresAt, token: crypto.randomUUID(), userId: orphanId }),
      (error: unknown) => hasPostgresCode(error, "23503")
    );
  } finally {
    await db.delete(users).where(inArray(users.email, emails));
    await db.delete(verifications).where(eq(verifications.identifier, prefix));
    await db.$client.end();
  }
});
