import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createDb, type Database } from "./client.ts";
import { apiKeys, tenants } from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

async function withTenants(
  run: (db: Database, firstId: string, secondId: string) => Promise<void>
) {
  const db = createDb();
  const slug = `api-keys-${crypto.randomUUID()}`;
  const rows = await db
    .insert(tenants)
    .values([
      { name: "First workspace", slug: `${slug}-first` },
      { name: "Second workspace", slug: `${slug}-second` },
    ])
    .returning();
  const [first, second] = rows;
  assert.ok(first && second);
  try {
    await run(db, first.id, second.id);
  } finally {
    await db.delete(tenants).where(eq(tenants.id, first.id));
    await db.delete(tenants).where(eq(tenants.id, second.id));
    await db.$client.end();
  }
}

function key(tenantId: string) {
  const token = `al_${randomBytes(32).toString("base64url")}`;
  const record = {
    digest: createHash("sha256").update(token).digest("hex"),
    name: "Integration",
    prefix: token.slice(0, 11),
    scopes: ["calls:read", "evals:write"],
    tenantId,
  } satisfies typeof apiKeys.$inferInsert;
  return { record, token };
}

test("API keys persist scoped digests and lifecycle metadata without bearer tokens", { skip }, () =>
  withTenants(async (db, firstId, secondId) => {
    const { record, token } = key(firstId);
    const [created] = await db.insert(apiKeys).values(record).returning();
    assert.ok(created);
    assert.equal(created.digest, record.digest);
    assert.equal(created.prefix, token.slice(0, 11));
    assert.deepEqual(created.scopes, ["calls:read", "evals:write"]);
    assert.equal(created.tenantId, firstId);
    assert.equal(created.lastUsedAt, null);
    assert.equal(created.revokedAt, null);
    assert.equal(JSON.stringify(created).includes(token), false);
    await assert.rejects(db.insert(apiKeys).values({ ...record, tenantId: secondId }));
    const secondKey = key(secondId);
    const [second] = await db.insert(apiKeys).values(secondKey.record).returning();
    assert.ok(second);
    const lastUsedAt = new Date("2026-10-25T10:00:00.000Z");
    const revokedAt = new Date("2026-10-25T11:00:00.000Z");
    await db.update(apiKeys).set({ lastUsedAt, revokedAt }).where(eq(apiKeys.id, created.id));
    const [updated] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.id));
    assert.equal(updated?.lastUsedAt?.toISOString(), lastUsedAt.toISOString());
    assert.equal(updated?.revokedAt?.toISOString(), revokedAt.toISOString());
    await db.delete(tenants).where(eq(tenants.id, firstId));
    assert.deepEqual(await db.select().from(apiKeys).where(eq(apiKeys.id, created.id)), []);
    const [remaining] = await db.select().from(apiKeys).where(eq(apiKeys.id, second.id));
    assert.equal(remaining?.tenantId, secondId);
  })
);

test(
  "API key storage rejects raw tokens, invalid display prefixes, and unsupported scopes",
  { skip },
  () =>
    withTenants(async (db, firstId) => {
      const { record, token } = key(firstId);
      await Promise.all(
        [token, "a".repeat(63), "A".repeat(64), "g".repeat(64)].map((digest) =>
          assert.rejects(db.insert(apiKeys).values({ ...record, digest }))
        )
      );
      await Promise.all(
        ["", token].map((prefix) =>
          assert.rejects(db.insert(apiKeys).values({ ...record, prefix }))
        )
      );
      await assert.rejects(db.insert(apiKeys).values({ ...record, scopes: [] }));
      await assert.rejects(
        db.$client`insert into api_keys (tenant_id, name, digest, prefix, scopes)
        values (${firstId}, ${record.name}, ${record.digest}, ${record.prefix}, ARRAY['unsupported']::api_key_scope[])`
      );
      await assert.rejects(
        db.$client`insert into api_keys (tenant_id, name, digest, prefix, scopes)
        values (${firstId}, ${record.name}, ${record.digest}, ${record.prefix}, ARRAY[NULL]::api_key_scope[])`
      );
      await assert.rejects(
        db.$client`insert into api_keys (tenant_id, name, digest, prefix, scopes)
        values (${firstId}, ${record.name}, ${record.digest}, ${record.prefix}, ARRAY['calls:read', NULL]::api_key_scope[])`
      );
      const [valid] = await db.insert(apiKeys).values(record).returning();
      assert.ok(valid);
    })
);
