import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { parseEnv } from "./env.ts";

test("defaults REDIS_URL and REDIS_PREFIX", () => {
  const env = parseEnv({});
  assert.equal(env.REDIS_URL, "redis://localhost:6379");
  assert.equal(env.REDIS_PREFIX, "bull");
  assert.equal(env.EMBEDDING_MODEL, "google/gemini-embedding-2");
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

test("validates an optional post-call model without requiring provider credentials", () => {
  assert.equal(parseEnv({ POST_CALL_MODEL: "ollama/qwen3" }).POST_CALL_MODEL, "ollama/qwen3");
  assert.equal(
    parseEnv({ POST_CALL_MODEL: "anthropic/claude-haiku" }).POST_CALL_MODEL,
    "anthropic/claude-haiku"
  );
  assert.equal(parseEnv({}).POST_CALL_MODEL, undefined);
  assert.throws(() => parseEnv({ POST_CALL_MODEL: "unknown/model" }));
});

test("rejects an invalid REDIS_URL", () => {
  assert.throws(() => parseEnv({ REDIS_URL: "not a url" }));
});

test("validates the optional worker health port", () => {
  assert.equal(parseEnv({}).WORKER_HEALTH_PORT, undefined);
  assert.equal(parseEnv({ WORKER_HEALTH_PORT: "8080" }).WORKER_HEALTH_PORT, 8080);
  for (const port of ["", "0", "65536", "1.5", "invalid"]) {
    assert.throws(() => parseEnv({ WORKER_HEALTH_PORT: port }));
  }
});

test("resolves KNOWLEDGE_FILES_DIR with a repo-root default", () => {
  assert.equal(parseEnv({}).KNOWLEDGE_FILES_DIR, resolve(process.cwd(), "../../.data/knowledge"));
  assert.equal(
    parseEnv({ KNOWLEDGE_FILES_DIR: "/srv/knowledge" }).KNOWLEDGE_FILES_DIR,
    "/srv/knowledge"
  );
});
