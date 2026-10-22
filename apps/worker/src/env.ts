import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().default("redis://localhost:6379"),
});

export const parseEnv = (source: NodeJS.ProcessEnv) => envSchema.parse(source);

export const env = parseEnv(process.env);
