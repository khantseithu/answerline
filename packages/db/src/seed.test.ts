import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb } from "./client.ts";
import { agents, tenants } from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : "DATABASE_URL not set";

test("startup seeding repairs missing defaults without overwriting agent edits", {
  skip,
}, async () => {
  assert.ok(databaseUrl);
  const name = `answerline_seed_${crypto.randomUUID().replaceAll("-", "")}`;
  const root = postgres(databaseUrl, { max: 1 });
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  let db: ReturnType<typeof createDb> | undefined;
  let created = false;
  try {
    await root.unsafe(`create database "${name}"`);
    created = true;
    db = createDb(url.toString());
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    });
    const seed = (...args: string[]) => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "src/seed.ts", ...args], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: url.toString() },
      });
      assert.equal(result.status, 0, result.stderr);
    };
    seed("--preserve-existing");
    const initial = await db.select().from(agents);
    const [edited, missing] = initial;
    assert.ok(edited && missing);
    const [tenant] = await db.select().from(tenants);
    assert.ok(tenant);
    await db.update(tenants).set({ name: "Edited tenant" }).where(eq(tenants.id, tenant.id));
    await db
      .update(agents)
      .set({
        config: { ...edited.config, instructions: "Keep these instructions" },
        name: "Edited agent",
      })
      .where(eq(agents.id, edited.id));
    await db.delete(agents).where(eq(agents.id, missing.id));
    seed("--preserve-existing");
    const after = await db.select().from(agents);
    assert.equal(after.length, initial.length);
    const preserved = after.find((agent) => agent.id === edited.id);
    assert.equal(preserved?.name, "Edited agent");
    assert.equal(preserved?.config.instructions, "Keep these instructions");
    assert.ok(after.some((agent) => agent.slug === missing.slug));
    assert.equal((await db.select().from(tenants))[0]?.name, "Edited tenant");
    seed();
    const [refreshed] = await db.select().from(agents).where(eq(agents.id, edited.id));
    assert.equal(refreshed?.config.instructions, edited.config.instructions);
    assert.equal(refreshed?.name, edited.name);
  } finally {
    await db?.$client.end();
    if (created) {
      await root.unsafe(`drop database "${name}"`);
    }
    await root.end();
  }
});
