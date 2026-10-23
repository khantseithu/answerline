import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv } from "./env.ts";

test("defaults REDIS_URL and REDIS_PREFIX", () => {
  const env = parseEnv({});
  assert.equal(env.REDIS_URL, "redis://localhost:6379");
  assert.equal(env.REDIS_PREFIX, "bull");
  assert.equal(env.EMBEDDING_MODEL, "openai/text-embedding-3-small");
  assert.equal(env.OLLAMA_BASE_URL, "http://localhost:11434");
});

test("validates embedding provider configuration without requiring unused keys", () => {
  assert.equal(
    parseEnv({ EMBEDDING_MODEL: "ollama/qwen3-embedding:4b" }).EMBEDDING_MODEL,
    "ollama/qwen3-embedding:4b"
  );
  assert.throws(() => parseEnv({ EMBEDDING_MODEL: "anthropic/model" }));
  assert.throws(() => parseEnv({ OLLAMA_BASE_URL: "invalid" }));
});

test("rejects an invalid REDIS_URL", () => {
  assert.throws(() => parseEnv({ REDIS_URL: "not a url" }));
});
