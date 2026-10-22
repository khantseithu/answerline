import { Redis } from "ioredis";
import { env } from "./env.ts";

export function createRedis() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}
