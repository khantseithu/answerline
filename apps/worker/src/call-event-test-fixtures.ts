import { readFile } from "node:fs/promises";
import { agents, type Database, tenants } from "@answerline/db";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";

export async function seedCallAgent(db: Database, tenant: string, agent = "bright-smile-dental") {
  await db.insert(tenants).values({ name: tenant, slug: tenant }).onConflictDoNothing();
  const [workspace] = await db.select().from(tenants).where(eq(tenants.slug, tenant));
  if (!workspace) {
    throw new Error("Test workspace not seeded");
  }
  const config = parseAgentConfig(
    await readFile(new URL("../../../agents/bright-smile-dental.yaml", import.meta.url), "utf8")
  );
  await db
    .insert(agents)
    .values({ config, name: config.name, slug: agent, tenantId: workspace.id })
    .onConflictDoNothing();
}
