import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  evalExecutionInputSchema,
  evalExecutionOutputSchema,
  evalJobSchema,
  evalRunCreateSchema,
  evalSuiteSchema,
  parseEvalSuite,
} from "./eval-suite.ts";
import { jsonSchema, schemaPath } from "./generate-json-schema.ts";

const minimalAgent = {
  greeting: "Hello",
  instructions: "Be helpful.",
  models: {
    llm: { primary: "openai/gpt-4.1-mini" },
    stt: "deepgram/nova-3",
    tts: "cartesia/sonic-3",
  },
  name: "Test agent",
};
const fixtures = new URL("../fixtures/eval/", import.meta.url);

async function fixtureData(kind: "valid" | "invalid") {
  const dir = new URL(`${kind}/`, fixtures);
  const files = await readdir(dir);
  return Promise.all(
    files.map(async (file) => ({
      data: JSON.parse(await readFile(new URL(file, dir), "utf8")) as unknown,
      file,
    }))
  );
}

test("keeps existing single-turn eval suites valid and accepts multi-turn mock cases", () => {
  assert.deepEqual(
    parseEvalSuite("- name: greeting\n  caller: Hi\n  expect:\n    mentions: [hello]\n"),
    [{ caller: "Hi", expect: { mentions: ["hello"] }, name: "greeting" }]
  );
  assert.deepEqual(
    evalSuiteSchema.parse([
      {
        caller: ["Hi", "Can I book tomorrow?"],
        expect: { tool_args: { book_appointment: { date: "tomorrow" } } },
        mocks: { book_appointment: { confirmation: "bk-123" } },
        name: "books tomorrow",
      },
    ]),
    [
      {
        caller: ["Hi", "Can I book tomorrow?"],
        expect: { tool_args: { book_appointment: { date: "tomorrow" } } },
        mocks: { book_appointment: { confirmation: "bk-123" } },
        name: "books tomorrow",
      },
    ]
  );
  assert.throws(() =>
    evalSuiteSchema.parse([
      { caller: "Hi", expect: {}, name: "duplicate" },
      { caller: "Hello", expect: {}, name: "duplicate" },
    ])
  );
});

test("execution input defaults to mocked text mode and accepts overrides", () => {
  assert.deepEqual(
    evalExecutionInputSchema.parse({
      agent: minimalAgent,
      suite: [{ caller: "Hi", expect: {}, name: "hello" }],
    }),
    {
      agent: {
        ...minimalAgent,
        language: "en",
        models: {
          llm: { fallback: [], primary: "openai/gpt-4.1-mini" },
          stt: "deepgram/nova-3",
          tts: "cartesia/sonic-3",
        },
        recording: {
          enabled: false,
          notice: "This call may be recorded for quality and training purposes.",
        },
        tools: [],
      },
      liveTools: false,
      mode: "text",
      suite: [{ caller: "Hi", expect: {}, name: "hello" }],
    }
  );
  assert.equal(
    evalExecutionInputSchema.parse({
      agent: minimalAgent,
      context: { agentSlug: "bright-smile-dental", tenantSlug: "default" },
      liveTools: true,
      mode: "audio",
      modelOverride: "openai/gpt-4.1",
      suite: [{ caller: "Hi", expect: {}, name: "hello" }],
    }).mode,
    "audio"
  );
  assert.throws(() =>
    evalExecutionInputSchema.parse({
      agent: minimalAgent,
      liveTools: true,
      suite: [{ caller: "Hi", expect: {}, name: "hello" }],
    })
  );
  assert.deepEqual(
    evalExecutionInputSchema.parse({
      agent: minimalAgent,
      context: { agentSlug: "bright-smile-dental", tenantSlug: "default" },
      liveTools: true,
      suite: [{ caller: "Hi", expect: {}, name: "hello" }],
    }).context,
    { agentSlug: "bright-smile-dental", tenantSlug: "default" }
  );
});

test("run create, queue, and execution results validate nullable metrics", () => {
  assert.equal(
    evalRunCreateSchema.parse({
      agentId: "0b9c1c3e-2f4a-4e8e-9d3a-5f1f2b7c9a10",
      suite: "bright-smile-dental",
    }).suite,
    "bright-smile-dental"
  );
  assert.throws(() =>
    evalRunCreateSchema.parse({
      agentId: crypto.randomUUID(),
      suite: "../bright-smile-dental.yaml",
    })
  );
  assert.doesNotThrow(() =>
    evalJobSchema.parse({
      agentId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
    })
  );
  assert.deepEqual(
    evalExecutionOutputSchema.parse({
      aggregate: { avgLatencyMs: null, avgWer: null, costUsd: null, passed: 0, total: 1 },
      results: [
        {
          caseName: "hello",
          costUsd: null,
          failures: ["judge failed"],
          latencyMs: null,
          passed: false,
          transcript: [{ role: "caller", text: "Hi" }],
          wer: null,
        },
      ],
    }).aggregate.costUsd,
    null
  );
  assert.equal(
    evalExecutionOutputSchema.parse({
      aggregate: { avgLatencyMs: null, avgWer: 0.25, costUsd: null, passed: 1, total: 1 },
      results: [
        {
          caseName: "hello",
          costUsd: null,
          failures: [],
          latencyMs: null,
          passed: true,
          transcript: [{ role: "caller", text: "Hi" }],
          wer: 0.25,
        },
      ],
    }).results[0]?.wer,
    0.25
  );
});

test("max_wer is a per-case expectation between 0 and 1", () => {
  const suite = (maxWer: number) => [{ caller: "Hi", expect: { max_wer: maxWer }, name: "hello" }];
  assert.equal(evalSuiteSchema.parse(suite(0.2))[0]?.expect.max_wer, 0.2);
  assert.doesNotThrow(() => evalSuiteSchema.parse(suite(0)));
  assert.doesNotThrow(() => evalSuiteSchema.parse(suite(1)));
  assert.throws(() => evalSuiteSchema.parse(suite(-0.1)));
  assert.throws(() => evalSuiteSchema.parse(suite(1.1)));
});

test("stt and tts overrides are validated model refs on input and run create", () => {
  const agentId = "0b9c1c3e-2f4a-4e8e-9d3a-5f1f2b7c9a10";
  const created = evalRunCreateSchema.parse({
    agentId,
    sttOverride: "deepgram/nova-3",
    suite: "bright-smile-dental",
    ttsOverride: "cartesia/sonic-3",
  });
  assert.equal(created.sttOverride, "deepgram/nova-3");
  assert.equal(created.ttsOverride, "cartesia/sonic-3");
  assert.throws(() =>
    evalRunCreateSchema.parse({ agentId, sttOverride: "nova-3", suite: "bright-smile-dental" })
  );
  assert.throws(() =>
    evalRunCreateSchema.parse({ agentId, suite: "bright-smile-dental", ttsOverride: "sonic-3" })
  );
  const input = evalExecutionInputSchema.parse({
    agent: minimalAgent,
    mode: "audio",
    sttOverride: "deepgram/nova-3",
    suite: [{ caller: "Hi", expect: {}, name: "hello" }],
    ttsOverride: "cartesia/sonic-3",
  });
  assert.equal(input.sttOverride, "deepgram/nova-3");
  assert.equal(input.ttsOverride, "cartesia/sonic-3");
  assert.throws(() =>
    evalExecutionInputSchema.parse({
      agent: minimalAgent,
      sttOverride: "nova-3",
      suite: [{ caller: "Hi", expect: {}, name: "hello" }],
    })
  );
});

test("generated eval JSON Schemas match their Zod contracts", async () => {
  const names = [
    "eval-execution-input",
    "eval-execution-output",
    "eval-job",
    "eval-run-create",
    "eval-suite",
  ] as const;
  await Promise.all(
    names.map(async (name) =>
      assert.equal(
        await readFile(schemaPath(name), "utf8"),
        jsonSchema(name),
        "run `pnpm --filter @answerline/shared generate:schema`"
      )
    )
  );
});

test("eval fixtures validate against the matching contracts", async () => {
  const schemas = {
    "execution-input.json": evalExecutionInputSchema,
    "execution-output.json": evalExecutionOutputSchema,
    "job.json": evalJobSchema,
    "run-create.json": evalRunCreateSchema,
    "suite.json": evalSuiteSchema,
  } as const;
  for (const { data, file } of await fixtureData("valid")) {
    const schema = Object.entries(schemas).find(([name]) => name === file)?.[1];
    assert.ok(schema, `unexpected fixture ${file}`);
    assert.doesNotThrow(() => schema.parse(data), file);
  }
  for (const { data, file } of await fixtureData("invalid")) {
    assert.throws(() => evalRunCreateSchema.parse(data), Error, file);
  }
});
