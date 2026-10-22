import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url().optional(),
  REDIS_PREFIX: z.string().min(1).default("bull"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
});

export const parseEnv = (source: NodeJS.ProcessEnv) => envSchema.parse(source);

export const env = parseEnv(process.env);
