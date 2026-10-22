import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentConfig } from "./agent-config.ts";
import { AGENT_CONFIG_SCHEMA_PATH, agentConfigJsonSchema } from "./generate-json-schema.ts";

const fixtures = new URL("../fixtures/agent-config/", import.meta.url);

async function readFixtures(kind: "valid" | "invalid") {
  const dir = new URL(`${kind}/`, fixtures);
  const files = await readdir(dir);
  return Promise.all(
    files.map(async (file) => ({ file, source: await readFile(new URL(file, dir), "utf8") }))
  );
}

test("accepts valid fixtures", async () => {
  for (const { file, source } of await readFixtures("valid")) {
    assert.doesNotThrow(() => parseAgentConfig(source), file);
  }
});

test("rejects invalid fixtures", async () => {
  for (const { file, source } of await readFixtures("invalid")) {
    assert.throws(() => parseAgentConfig(source), Error, file);
  }
});

test("committed JSON Schema matches zod schema", async () => {
  assert.equal(
    await readFile(AGENT_CONFIG_SCHEMA_PATH, "utf8"),
    agentConfigJsonSchema(),
    "run `pnpm --filter @answerline/shared generate:schema`"
  );
});
