import { fileURLToPath } from "node:url";
import { initializeFirstAdmin, parseAdminEnvironment } from "./admin.ts";
import { createDb } from "./client.ts";

async function main() {
  const environment = parseAdminEnvironment(process.env);
  const db = createDb(environment.DATABASE_URL);
  try {
    const result = await initializeFirstAdmin({
      credentialsPath: fileURLToPath(new URL("../../../.data/admin-credentials", import.meta.url)),
      db,
      environment,
      envPath: fileURLToPath(new URL("../../../.env", import.meta.url)),
    });
    if (result.created) {
      process.stdout.write(`admin:init: created administrator ${result.email}\n`);
      process.stdout.write(
        result.credentialsPath
          ? `admin:init: initial password saved to ${result.credentialsPath}\n`
          : "admin:init: using the configured ADMIN_PASSWORD\n"
      );
    } else {
      process.stdout.write("admin:init: an account already exists; credentials unchanged\n");
    }
  } finally {
    await db.$client.end();
  }
}

main().catch(() => {
  process.stderr.write(
    "admin:init: failed; check database connectivity, applied migrations, and admin environment settings\n"
  );
  process.exitCode = 1;
});
