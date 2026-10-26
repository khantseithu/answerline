import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { jsonSchema, schemaPath } from "./generate-json-schema.ts";
import { outboundCallRequestSchema, outboundCallResponseSchema } from "./outbound-calls.ts";

test("outbound call request validates agent and E.164 phone numbers", () => {
  assert.deepEqual(
    outboundCallRequestSchema.parse({
      agent: "front-desk",
      fromNumber: "+15551234567",
      toNumber: "+15557654321",
    }),
    { agent: "front-desk", fromNumber: "+15551234567", toNumber: "+15557654321" }
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
