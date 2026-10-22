import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentConfig } from "./agent-config.ts";
import { parseEvalSuite } from "./eval-suite.ts";

const root = new URL("../../../", import.meta.url);

test("example agent config parses", async () => {
  const config = parseAgentConfig(
    await readFile(new URL("agents/bright-smile-dental.yaml", root), "utf8")
  );
  assert.equal(config.name, "Bright Smile Dental");
  assert.deepEqual(config.models.llm.fallback, ["openai/gpt-4.1-mini", "google/gemini-2.5-flash"]);
  assert.equal(config.tools.length, 3);
});

test("example eval suite parses", async () => {
  const suite = parseEvalSuite(
    await readFile(new URL("evals/bright-smile-dental.yaml", root), "utf8")
  );
  assert.equal(suite.length, 2);
  assert.equal(suite[0]?.expect.tool_called, "book_appointment");
});

test("rejects model without provider", () => {
  assert.throws(() =>
    parseAgentConfig(
      "name: x\ngreeting: hi\ninstructions: be nice\nmodels:\n  stt: nova\n  llm:\n    primary: anthropic/claude-sonnet\n  tts: cartesia/sonic\n"
    )
  );
});
