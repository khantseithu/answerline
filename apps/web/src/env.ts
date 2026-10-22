import { z } from "zod";

const envSchema = z.object({
  AGENT_NAME: z.string().min(1).default("answerline"),
  LIVEKIT_API_KEY: z.string().min(1).default("devkey"),
  LIVEKIT_API_SECRET: z.string().min(1).default("secret"),
  LIVEKIT_URL: z.url().default("ws://localhost:7880"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const parseEnv = (source: NodeJS.ProcessEnv) => envSchema.parse(source);

export const env = parseEnv(process.env);
