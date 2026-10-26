import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";
import {
  ApiKeyRateLimitError,
  enforceApiKeyRateLimit,
  isApiKeyRateLimitUnavailableError,
} from "./rate-limit";

test("API key rate limit uses an atomic Redis fixed-window counter", async () => {
  let command = "";
  const redis = {
    eval(script: string, keyCount: number, key: string, windowSeconds: string) {
      command = `${script}:${keyCount}:${key}:${windowSeconds}`;
      return Promise.resolve([60, 60]);
    },
  };

  await enforceApiKeyRateLimit(redis, "key-id");

  assert.ok(command.includes("INCR"));
  assert.ok(command.includes("EXPIRE"));
  assert.ok(command.endsWith("api-rate-limit:key-id:60"));
});

test("API key rate limit returns the remaining window after the limit is exceeded", async () => {
  const redis = {
    eval() {
      return Promise.resolve([61, 23]);
    },
  };

  await assert.rejects(enforceApiKeyRateLimit(redis, "key-id"), (error: unknown) => {
    assert.ok(error instanceof ApiKeyRateLimitError);
    assert.equal(error.retryAfterSeconds, 23);
    return true;
  });
});

test("API key rate limit responses include a retry delay", async () => {
  const response = dashboardErrorResponse(new ApiKeyRateLimitError(23));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "23");
  assert.deepEqual(await response.json(), { error: "API key request limit exceeded" });
});

test("API key rate limit fails closed when Redis is unavailable", async () => {
  const redis = {
    eval() {
      return Promise.reject(new Error("Redis unavailable"));
    },
  };

  await assert.rejects(enforceApiKeyRateLimit(redis, "key-id"), isApiKeyRateLimitUnavailableError);
});
