import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseAgentConfig } from "@answerline/shared";
import { createDb } from "./client.ts";
import { agents, tenants } from "./schema.ts";

const agentsDir = new URL("../../../agents/", import.meta.url);
const db = createDb();

const [tenant] = await db
  .insert(tenants)
  .values({ slug: "default", name: "Default" })
  .onConflictDoUpdate({ target: tenants.slug, set: { name: "Default" } })
  .returning();
if (!tenant) throw new Error("failed to upsert default tenant");

for (const file of (await readdir(agentsDir)).filter((f) => f.endsWith(".yaml"))) {
  const config = parseAgentConfig(await readFile(new URL(file, agentsDir), "utf8"));
  const slug = basename(file, ".yaml");
  await db
    .insert(agents)
    .values({ tenantId: tenant.id, slug, name: config.name, config })
    .onConflictDoUpdate({
      target: [agents.tenantId, agents.slug],
      set: { name: config.name, config },
    });
  console.log(`seeded agent ${slug}`);
}

await db.$client.end();
