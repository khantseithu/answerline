import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  AGENT_NAME: z.string().min(1).default("answerline"),
  DATABASE_URL: z.url().optional(),
  KNOWLEDGE_FILES_DIR: z
    .string()
    .min(1)
    .default(() => resolve(process.cwd(), "../../.data/knowledge"))
    .transform((dir) => resolve(dir)),
  LIVEKIT_API_KEY: z.string().min(1).default("devkey"),
  LIVEKIT_API_SECRET: z.string().min(1).default("secret"),
  LIVEKIT_URL: z.url().default("ws://localhost:7880"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_PREFIX: z.string().min(1).default("bull"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  TENANT: z.string().min(1).default("default"),
});

export const parseEnv = (source: NodeJS.ProcessEnv) => envSchema.parse(source);

export const env = parseEnv(process.env);
