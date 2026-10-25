import { migrateDatabase } from "./migrations.ts";

await migrateDatabase(process.env.DATABASE_URL, {
  tenant: process.env.TENANT ?? "default",
});
console.log("migrations applied");
