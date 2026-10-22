import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://answerline:answerline@localhost:5432/answerline",
  },
});
