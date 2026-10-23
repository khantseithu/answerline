import { defineConfig } from "drizzle-kit";

export default defineConfig({
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://answerline:answerline@localhost:5432/answerline",
  },
  dialect: "postgresql",
  out: "./migrations",
  schema: "./src/schema.ts",
});
