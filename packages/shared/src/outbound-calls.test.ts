import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { jsonSchema, schemaPath } from "./generate-json-schema.ts";
import {
  outboundCallRequestSchema,
  outboundCallResponseSchema,
  outboundDialJobSchema,
} from "./outbound-calls.ts";

test("outbound call request validates agent and E.164 phone numbers", () => {
  assert.deepEqual(
    outboundCallRequestSchema.parse({
      agent: "front-desk",
      toNumber: "+15557654321",
    }),
    { agent: "front-desk", toNumber: "+15557654321" }
  );
  assert.equal(
    outboundCallRequestSchema.safeParse({ agent: "../other", toNumber: "+15557654321" }).success,
    false
  );
  assert.equal(
    outboundCallRequestSchema.safeParse({ agent: "front-desk", toNumber: "5551234567" }).success,
    false
  );
});

test("outbound call response includes the initiated call identity", () => {
  assert.equal(
    outboundCallResponseSchema.safeParse({
      callId: "00000000-0000-4000-8000-000000000001",
      roomName: "call-00000000-0000-4000-8000-000000000001",
      status: "initiated",
    }).success,
    true
  );
});

test("committed outbound call JSON Schemas match Zod", async () => {
  assert.equal(
    await readFile(schemaPath("outbound-call-request"), "utf8"),
    jsonSchema("outbound-call-request")
  );
  assert.equal(
    await readFile(schemaPath("outbound-call-response"), "utf8"),
    jsonSchema("outbound-call-response")
  );
});

test("outbound dial jobs validate routing data and reject extra fields", () => {
  const job = {
    agent: "front-desk",
    callId: "123e4567-e89b-42d3-a456-426614174000",
    roomName: "call-123e4567-e89b-42d3-a456-426614174000",
    tenant: "dental",
    toNumber: "+15551234567",
    waitForAgentReady: true,
  };
  assert.deepEqual(outboundDialJobSchema.parse(job), job);
  assert.equal(outboundDialJobSchema.safeParse({ ...job, trunkId: "secret" }).success, false);
  assert.equal(outboundDialJobSchema.safeParse({ ...job, toNumber: "5551234567" }).success, false);
});
