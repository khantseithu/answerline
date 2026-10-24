import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z
  .object({
    AGENT_NAME: z.string().min(1).default("answerline"),
    AUTH_GITHUB_CLIENT_ID: z.string().min(1).optional(),
    AUTH_GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
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
  })
  .refine(
    (value) => Boolean(value.AUTH_GITHUB_CLIENT_ID) === Boolean(value.AUTH_GITHUB_CLIENT_SECRET),
    { message: "GitHub OAuth requires both AUTH_GITHUB_CLIENT_ID and AUTH_GITHUB_CLIENT_SECRET" }
  );

export const parseEnv = (source: NodeJS.ProcessEnv) => envSchema.parse(source);

export const env = parseEnv(process.env);
