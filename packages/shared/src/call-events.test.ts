import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { callEventJob, callEventJobId } from "./call-events.ts";
import { jsonSchema, schemaPath } from "./generate-json-schema.ts";

const fixtures = new URL("../fixtures/call-event/", import.meta.url);

async function readFixtures(kind: "valid" | "invalid") {
  const dir = new URL(`${kind}/`, fixtures);
  const files = await readdir(dir);
  return Promise.all(
    files.map(async (file) => ({
      data: JSON.parse(await readFile(new URL(file, dir), "utf8")) as unknown,
      file,
    }))
  );
}

test("accepts valid call event fixtures", async () => {
  for (const { data, file } of await readFixtures("valid")) {
    assert.doesNotThrow(() => callEventJob.parse(data), file);
  }
});

test("rejects invalid call event fixtures", async () => {
  for (const { data, file } of await readFixtures("invalid")) {
    assert.throws(() => callEventJob.parse(data), Error, file);
  }
});

test("job ids are stable per room, type, and turn", () => {
  const base = { agent: "a", room_name: "call-1", tenant: "default" } as const;
  const turn = callEventJob.parse({
    ...base,
    role: "caller",
    seq: 3,
    started_at: "2026-10-22T14:00:00.000Z",
    text: "hi",
    type: "call.turn",
  });
  const started = callEventJob.parse({
    ...base,
    channel: "web",
    started_at: "2026-10-22T14:00:00.000Z",
    type: "call.started",
  });
  const tool = callEventJob.parse({
    ...base,
    args: {},
    latency_ms: 5,
    name: "search_knowledge",
    seq: 2,
    started_at: "2026-10-22T14:00:00.000Z",
    status: "ok",
    type: "call.tool",
  });
  assert.equal(callEventJobId(tool), "call-1_call.tool_2");
  assert.equal(callEventJobId(turn), "call-1_call.turn_3");
  assert.equal(callEventJobId(started), "call-1_call.started");
});

test("committed call event JSON Schema matches zod schema", async () => {
  assert.equal(
    await readFile(schemaPath("call-event"), "utf8"),
    jsonSchema("call-event"),
    "run `pnpm --filter @answerline/shared generate:schema`"
  );
});

test("lead event ids distinguish leads and stay stable for retries", async () => {
  const data = JSON.parse(
    await readFile(new URL("valid/lead-created.json", fixtures), "utf8")
  ) as unknown;
  const lead = callEventJob.parse(data);
  const expected = `${lead.room_name}_lead.created_0b9c1c3e-2f4a-4e8e-9d3a-5f1f2b7c9a10`;
  assert.equal(callEventJobId(lead), expected);
  assert.equal(callEventJobId(callEventJob.parse(data)), expected);
  assert.notEqual(
    callEventJobId(callEventJob.parse({ ...lead, lead_id: crypto.randomUUID() })),
    expected
  );
});

test("lead ids are canonical across producer languages", async () => {
  const data = JSON.parse(
    await readFile(new URL("valid/lead-created.json", fixtures), "utf8")
  ) as unknown;
  const lead = callEventJob.parse(data);
  const upper = callEventJob.parse({
    ...lead,
    lead_id: "0B9C1C3E-2F4A-4E8E-9D3A-5F1F2B7C9A10",
  });
  assert.equal(callEventJobId(upper), callEventJobId(lead));
});
