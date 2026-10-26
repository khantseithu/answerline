import { resolve } from "node:path";
import { embeddingEnvSchema, parseModelRef } from "@answerline/llm";
import { z } from "zod";

const envSchema = embeddingEnvSchema.extend({
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  DATABASE_URL: z.url().optional(),
  KNOWLEDGE_FILES_DIR: z
    .string()
    .min(1)
    .default(() => resolve(process.cwd(), "../../.data/knowledge"))
    .transform((dir) => resolve(dir)),
  POST_CALL_MODEL: z
    .string()
    .optional()
    .refine((ref) => {
      if (!ref) {
        return true;
      }
      try {
        parseModelRef(ref);
        return true;
      } catch {
        return false;
      }
    }, "Expected a supported provider/model reference"),
  PROVIDER_KEYS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  REDIS_PREFIX: z.string().min(1).default("bull"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
});

export const parseEnv = (source: NodeJS.ProcessEnv) => envSchema.parse(source);

export const env = parseEnv(process.env);
