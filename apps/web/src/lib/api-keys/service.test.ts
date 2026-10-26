import assert from "node:assert/strict";
import { test } from "node:test";
import { createDb, sessions, tenants, users } from "@answerline/db";
import { eq, sql } from "drizzle-orm";
import type { WorkspaceDeps } from "@/lib/workspaces/service";
import { createWorkspace } from "@/lib/workspaces/service";
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from "./service";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const tokenPattern = /^al_[A-Za-z0-9_-]{43}$/;

test("workspace API keys are owner-managed, scoped, one-time secrets with revocation and last-use tracking", {
  skip,
}, async () => {
  const db = createDb();
  const id = crypto.randomUUID();
  const email = (name: string) => `${name}-${id}@example.com`;
  const makeUser = async (name: string): Promise<WorkspaceDeps> => {
    const [user] = await db
      .insert(users)
      .values({ email: email(name), name })
      .returning();
    assert.ok(user);
    const [session] = await db
      .insert(sessions)
      .values({
        expiresAt: new Date(Date.now() + 60_000),
        token: crypto.randomUUID(),
        userId: user.id,
      })
      .returning();
    assert.ok(session);
    return { db, session, user };
  };
  try {
    const owner = await makeUser("owner");
    const outsider = await makeUser("outsider");
    const first = await createWorkspace(owner, { name: "First", slug: `first-${id}` });
    const second = await createWorkspace(outsider, { name: "Second", slug: `second-${id}` });

    const created = await createApiKey(owner, first.id, {
      name: "Read-only script",
      scopes: ["calls:read", "agents:read"],
    });
    assert.match(created.token, tokenPattern);
    assert.equal(await authenticateApiKey(db, "not-a-valid-key"), null);
    const authenticated = await authenticateApiKey(db, created.token);
    assert.deepEqual(authenticated?.scopes, ["calls:read", "agents:read"]);
    assert.equal(authenticated?.tenantId, first.id);

    let releaseLock!: () => void;
    let signalLockAcquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const heldLock = db.transaction(async (tx) => {
      await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, first.id))
        .for("update");
      signalLockAcquired();
      await lockReleased;
    });
    await lockAcquired;
    const listPromise = listApiKeys(owner, first.id);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const completedWhileLocked = await Promise.race([
      listPromise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), 1000);
      }),
    ]);
    clearTimeout(timeout);
    releaseLock();
    await heldLock;
    const listed = await listPromise;
    assert.equal(completedWhileLocked, true, "API key reads should not wait for workspace writes");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.prefix, created.token.slice(0, 11));
    assert.ok(listed[0]?.lastUsedAt instanceof Date);
    assert.equal("digest" in (listed[0] ?? {}), false);
    assert.equal("token" in (listed[0] ?? {}), false);

    await assert.rejects(createApiKey(outsider, first.id, { name: "No", scopes: ["calls:read"] }));
    await assert.rejects(listApiKeys(owner, second.id));
    await assert.rejects(revokeApiKey(owner, second.id, listed[0]?.id ?? ""));

    await revokeApiKey(owner, first.id, listed[0]?.id ?? "");
    assert.equal(await authenticateApiKey(db, created.token), null);
    await revokeApiKey(owner, first.id, listed[0]?.id ?? "");
    assert.ok((await listApiKeys(owner, first.id))[0]?.revokedAt instanceof Date);
  } finally {
    await db.delete(tenants).where(sql`${tenants.slug} like ${`%${id}`}`);
    await db.delete(users).where(sql`${users.email} like ${`%${id}@example.com`}`);
    await db.$client.end();
  }
});
