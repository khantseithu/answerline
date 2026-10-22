import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv } from "./env.ts";

test("defaults REDIS_URL and REDIS_PREFIX", () => {
  const env = parseEnv({});
  assert.equal(env.REDIS_URL, "redis://localhost:6379");
  assert.equal(env.REDIS_PREFIX, "bull");
});

test("rejects an invalid REDIS_URL", () => {
  assert.throws(() => parseEnv({ REDIS_URL: "not a url" }));
});
