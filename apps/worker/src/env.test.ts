import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv } from "./env.ts";

test("defaults REDIS_URL", () => {
  assert.equal(parseEnv({}).REDIS_URL, "redis://localhost:6379");
});

test("rejects an invalid REDIS_URL", () => {
  assert.throws(() => parseEnv({ REDIS_URL: "not a url" }));
});
