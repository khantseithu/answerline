import assert from "node:assert/strict";
import { test } from "node:test";
import { cosineDistance, eq, sql } from "drizzle-orm";
import { createDb } from "./client.ts";
import { EMBEDDING_DIMENSIONS, knowledgeChunks, knowledgeSources, tenants } from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("knowledge chunks support vector and full-text search", { skip }, async () => {
  const db = createDb();
  const slug = `test-${crypto.randomUUID()}`;
  try {
    const [tenant] = await db.insert(tenants).values({ slug, name: slug }).returning();
    assert.ok(tenant);
    const [source] = await db
      .insert(knowledgeSources)
      .values({ tenantId: tenant.id, type: "text" })
      .returning();
    assert.ok(source);

    const near = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
    const far = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0));
    await db.insert(knowledgeChunks).values([
      {
        tenantId: tenant.id,
        sourceId: source.id,
        seq: 0,
        content: "We open at nine",
        embedding: near,
      },
      {
        tenantId: tenant.id,
        sourceId: source.id,
        seq: 1,
        content: "Cleanings cost $90",
        embedding: far,
      },
    ]);

    const [nearest] = await db
      .select({ content: knowledgeChunks.content })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.tenantId, tenant.id))
      .orderBy(cosineDistance(knowledgeChunks.embedding, near))
      .limit(1);
    assert.equal(nearest?.content, "We open at nine");

    const matches = await db
      .select({ content: knowledgeChunks.content })
      .from(knowledgeChunks)
      .where(
        sql`${knowledgeChunks.tenantId} = ${tenant.id} and ${knowledgeChunks.search} @@ plainto_tsquery('simple', 'cleanings')`,
      );
    assert.deepEqual(matches, [{ content: "Cleanings cost $90" }]);
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, slug));
    await db.$client.end();
  }
});
