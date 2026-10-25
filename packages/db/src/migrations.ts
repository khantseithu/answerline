import { fileURLToPath } from "node:url";
import { workspaceSlugSchema } from "@answerline/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { z } from "zod";

export async function migrateDatabase(
  url: string | undefined,
  {
    tenant = "default",
    migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url)),
  }: { tenant?: string; migrationsFolder?: string } = {}
) {
  const slug = workspaceSlugSchema.parse(tenant);
  const client = postgres(z.url().parse(url), {
    connection: { "answerline.bootstrap_tenant": slug },
    max: 1,
  });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
