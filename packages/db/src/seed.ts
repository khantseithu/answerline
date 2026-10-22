import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseAgentConfig } from "@answerline/shared";
import { createDb } from "./client.ts";
import { agents, tenants } from "./schema.ts";

const agentsDir = new URL("../../../agents/", import.meta.url);
const db = createDb();

const [tenant] = await db
  .insert(tenants)
  .values({ name: "Default", slug: "default" })
  .onConflictDoUpdate({ set: { name: "Default" }, target: tenants.slug })
  .returning();
if (!tenant) {
  throw new Error("failed to upsert default tenant");
}

const files = (await readdir(agentsDir)).filter((f) => f.endsWith(".yaml"));

await Promise.all(
  files.map(async (file) => {
    const config = parseAgentConfig(await readFile(new URL(file, agentsDir), "utf8"));
    const slug = basename(file, ".yaml");
    await db
      .insert(agents)
      .values({ config, name: config.name, slug, tenantId: tenant.id })
      .onConflictDoUpdate({
        set: { config, name: config.name },
        target: [agents.tenantId, agents.slug],
      });
    console.log(`seeded agent ${slug}`);
  })
);

await db.$client.end();
