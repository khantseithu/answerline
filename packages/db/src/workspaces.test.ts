import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { z } from "zod";
import { initializeFirstAdmin, parseAdminEnvironment } from "./admin.ts";
import { createDb, type Database } from "./client.ts";
import { migrateDatabase } from "./migrations.ts";
import { sessions, tenants, users, workspaceInvitations, workspaceMembers } from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : "DATABASE_URL not set";
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const journalSchema = z
  .object({ entries: z.array(z.object({ idx: z.number() }).passthrough()) })
  .passthrough();

async function withDatabase(run: (db: Database, url: string) => Promise<void>) {
  assert.ok(databaseUrl);
  const name = `answerline_workspace_${crypto.randomUUID().replaceAll("-", "")}`;
  const root = postgres(databaseUrl, { max: 1 });
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  let db: Database | undefined;
  let created = false;
  try {
    await root.unsafe(`create database "${name}"`);
    created = true;
    db = createDb(url.toString());
    await run(db, url.toString());
  } finally {
    await db?.$client.end();
    if (created) {
      await root.unsafe(`drop database "${name}" with (force)`);
    }
    await root.end();
  }
}

test(
  "workspace migration scopes legacy owners to configured tenant and never promotes later users",
  { skip },
  () =>
    withDatabase(async (db, url) => {
      const directory = await mkdtemp(join(tmpdir(), "answerline-workspace-upgrade-"));
      try {
        const baseline = join(directory, "migrations");
        await cp(migrationsFolder, baseline, { recursive: true });
        const journalPath = join(baseline, "meta/_journal.json");
        const journal = journalSchema.parse(JSON.parse(await readFile(journalPath, "utf8")));
        journal.entries = journal.entries.filter((entry) => entry.idx < 10);
        await writeFile(journalPath, JSON.stringify(journal));
        await migrateDatabase(url, { migrationsFolder: baseline });
        const [legacy] = await db
          .insert(users)
          .values({ email: "legacy@example.com", name: "Legacy" })
          .returning();
        assert.ok(legacy);
        const [unrelated] = await db
          .insert(tenants)
          .values({ name: "Unrelated", slug: "unrelated" })
          .returning();
        assert.ok(unrelated);
        await db.$client`insert into sessions (expires_at, token, user_id)
          values (${new Date(Date.now() + 60_000).toISOString()}, ${crypto.randomUUID()}, ${legacy.id})`;
        await migrateDatabase(url, { tenant: "configured-clinic" });
        const [workspace] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.slug, "configured-clinic"));
        assert.ok(workspace);
        const memberships = await db.select().from(workspaceMembers);
        assert.equal(memberships.length, 1);
        assert.equal(memberships[0]?.tenantId, workspace.id);
        assert.equal(memberships[0]?.userId, legacy.id);
        assert.equal(memberships[0]?.role, "owner");
        assert.equal((await db.select().from(sessions))[0]?.activeTenantId, workspace.id);
        const [later] = await db
          .insert(users)
          .values({ email: "later@example.com", name: "Later" })
          .returning();
        assert.ok(later);
        await db
          .insert(workspaceMembers)
          .values({ role: "viewer", tenantId: workspace.id, userId: later.id });
        await migrateDatabase(url, { tenant: "unrelated" });
        await initializeFirstAdmin({
          credentialsPath: join(directory, "credentials"),
          db,
          environment: parseAdminEnvironment({ DATABASE_URL: url, TENANT: "unrelated" }),
          envPath: join(directory, ".env"),
        });
        assert.equal((await db.select().from(workspaceMembers)).length, 2);
        assert.deepEqual(
          await db
            .select({ role: workspaceMembers.role })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.userId, later.id)),
          [{ role: "viewer" }]
        );
        assert.deepEqual(
          await db
            .select()
            .from(workspaceMembers)
            .where(eq(workspaceMembers.tenantId, unrelated.id)),
          []
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    })
);

test(
  "workspace persistence enforces membership uniqueness, hashed invitations, and tenant cleanup",
  { skip },
  () =>
    withDatabase(async (db, url) => {
      await migrateDatabase(url);
      const [user] = await db
        .insert(users)
        .values({ email: "owner@example.com", name: "Owner" })
        .returning();
      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Clinic", slug: "clinic" })
        .returning();
      assert.ok(user && tenant);
      const membership = {
        role: "owner",
        tenantId: tenant.id,
        userId: user.id,
      } satisfies typeof workspaceMembers.$inferInsert;
      await db.insert(workspaceMembers).values(membership);
      await assert.rejects(db.insert(workspaceMembers).values(membership));
      const tokenHash = createHash("sha256").update(crypto.randomUUID()).digest("hex");
      const invitation = {
        email: "invitee@example.com",
        expiresAt: new Date(Date.now() + 60_000),
        invitedBy: user.id,
        role: "viewer",
        tenantId: tenant.id,
        tokenHash,
      } satisfies typeof workspaceInvitations.$inferInsert;
      await db.insert(workspaceInvitations).values(invitation);
      await assert.rejects(db.insert(workspaceInvitations).values(invitation));
      await assert.rejects(
        db.insert(workspaceInvitations).values({ ...invitation, tokenHash: "raw-invitation-token" })
      );
      await assert.rejects(
        db
          .insert(workspaceInvitations)
          .values({ ...invitation, expiresAt: new Date(0), tokenHash: "a".repeat(64) })
      );
      await db.insert(sessions).values({
        activeTenantId: tenant.id,
        expiresAt: new Date(Date.now() + 60_000),
        token: crypto.randomUUID(),
        userId: user.id,
      });
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
      assert.deepEqual(await db.select().from(workspaceMembers), []);
      assert.deepEqual(await db.select().from(workspaceInvitations), []);
      assert.equal((await db.select().from(sessions))[0]?.activeTenantId, null);
    })
);
