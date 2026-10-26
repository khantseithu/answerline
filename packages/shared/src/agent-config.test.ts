import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { DEFAULT_RECORDING_NOTICE, parseAgentConfig } from "./agent-config.ts";
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

test("recording is off by default with the standard notice", async () => {
  const source = await readFile(new URL("valid/minimal.yaml", fixtures), "utf8");
  assert.deepEqual(parseAgentConfig(source).recording, {
    enabled: false,
    notice: DEFAULT_RECORDING_NOTICE,
  });
});

test("outbound policies default to one attempt, AMD off, and configured-hours enforcement", async () => {
  const source = await readFile(new URL("valid/minimal.yaml", fixtures), "utf8");
  const config = parseAgentConfig(`${source}\noutbound: {}\n`);
  assert.deepEqual(config.outbound, {
    answering_machine_detection: false,
    respect_calling_hours: true,
    retry: { delay_seconds: 60, max_attempts: 1 },
  });
});

test("recording enabled keeps the default notice when none is set", () => {
  const source = `name: A
greeting: Hi
instructions: Be brief.
models:
  stt: deepgram/nova-3
  llm:
    primary: anthropic/claude-sonnet-4-6
  tts: cartesia/sonic-3
recording:
  enabled: true
`;
  assert.deepEqual(parseAgentConfig(source).recording, {
    enabled: true,
    notice: DEFAULT_RECORDING_NOTICE,
  });
});

test("committed JSON Schema matches zod schema", async () => {
  assert.equal(
    await readFile(AGENT_CONFIG_SCHEMA_PATH, "utf8"),
    agentConfigJsonSchema(),
    "run `pnpm --filter @answerline/shared generate:schema`"
  );
});

test("book_appointment defaults to the native provider with 30 minute slots", () => {
  const source = `name: A
greeting: Hi
instructions: Be brief.
models:
  stt: deepgram/nova-3
  llm:
    primary: anthropic/claude-sonnet-4-6
  tts: cartesia/sonic-3
tools:
  - builtin: book_appointment
`;
  assert.deepEqual(parseAgentConfig(source).tools, [
    { builtin: "book_appointment", provider: "answerline", slot_minutes: 30 },
  ]);
});
