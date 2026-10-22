import assert from "node:assert/strict";
import { test } from "node:test";
import { AllProvidersFailedError, parseModelRef, withFallback } from "./index.ts";

test("parses provider/model refs", () => {
  assert.deepEqual(parseModelRef("ollama/llama3.1:8b"), {
    provider: "ollama",
    model: "llama3.1:8b",
  });
  assert.throws(() => parseModelRef("acme/foo"));
});

test("falls back to the next provider on failure", async () => {
  const { ref, result } = await withFallback(["anthropic/a", "openai/b"], async (m) => {
    if (m.provider === "anthropic") throw new Error("down");
    return m.model;
  });
  assert.equal(ref, "openai/b");
  assert.equal(result, "b");
});

test("throws when every provider fails", async () => {
  await assert.rejects(
    withFallback(["anthropic/a"], async () => {
      throw new Error("down");
    }),
    AllProvidersFailedError,
  );
});
