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
  assert.equal(callEventJobId(turn), "call-1:call.turn:3");
  assert.equal(callEventJobId(started), "call-1:call.started");
});

test("committed call event JSON Schema matches zod schema", async () => {
  assert.equal(
    await readFile(schemaPath("call-event"), "utf8"),
    jsonSchema("call-event"),
    "run `pnpm --filter @answerline/shared generate:schema`"
  );
});
