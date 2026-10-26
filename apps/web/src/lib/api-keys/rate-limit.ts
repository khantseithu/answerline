import { Redis } from "ioredis";
import { env } from "@/env";

const LIMIT = 60;
const WINDOW_SECONDS = 60;
const SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return {count, redis.call("TTL", KEYS[1])}
`;

interface RateLimitRedis {
  eval: (script: string, numberOfKeys: number, ...args: string[]) => Promise<unknown>;
}

export class ApiKeyRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("API key request limit exceeded");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function createApiKeyRateLimitUnavailableError(cause: unknown) {
  const error = new Error("API key rate limiting is unavailable", { cause });
  error.name = "ApiKeyRateLimitUnavailableError";
  return error;
}

export function isApiKeyRateLimitUnavailableError(error: unknown) {
  return error instanceof Error && error.name === "ApiKeyRateLimitUnavailableError";
}

const globalForRateLimit = globalThis as typeof globalThis & { rateLimitRedis?: Redis };

function getRedis() {
  globalForRateLimit.rateLimitRedis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  return globalForRateLimit.rateLimitRedis;
}

export async function enforceApiKeyRateLimit(redis: RateLimitRedis, keyId: string) {
  let result: unknown;
  try {
    result = await redis.eval(
      SCRIPT,
      1,
      `${env.REDIS_PREFIX}:api-rate-limit:${keyId}`,
      String(WINDOW_SECONDS)
    );
  } catch (error) {
    throw createApiKeyRateLimitUnavailableError(error);
  }
  if (!Array.isArray(result) || typeof result[0] !== "number" || typeof result[1] !== "number") {
    throw createApiKeyRateLimitUnavailableError(new Error("Invalid Redis rate limit response"));
  }
  if (result[0] > LIMIT) {
    throw new ApiKeyRateLimitError(Math.max(1, result[1]));
  }
}

export function enforceRequestRateLimit(keyId: string) {
  return enforceApiKeyRateLimit(getRedis(), keyId);
}
