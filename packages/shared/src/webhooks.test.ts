import assert from "node:assert/strict";
import { test } from "node:test";
import {
  webhookEndpointCreateSchema,
  webhookEndpointUpdateSchema,
  webhookEventSchema,
} from "./events.ts";

test("webhook endpoints require a supported URL and unique event subscriptions", () => {
  const input = {
    events: ["call.started", "call.ended"],
    name: "CRM",
    url: "https://hooks.example.test/answerline",
  };
  assert.equal(webhookEndpointCreateSchema.parse(input).enabled, true);
  assert.equal(
    webhookEndpointCreateSchema.safeParse({ ...input, events: ["call.ended", "call.ended"] })
      .success,
    false
  );
  assert.equal(
    webhookEndpointCreateSchema.safeParse({ ...input, url: "ftp://example.test" }).success,
    false
  );
  assert.equal(
    webhookEndpointCreateSchema.safeParse({ ...input, url: "https://user:pass@example.test" })
      .success,
    false
  );
  assert.equal(webhookEndpointCreateSchema.safeParse({ ...input, events: [] }).success, false);
});

test("webhook event payloads have stable envelope fields and typed event names", () => {
  const event = {
    created_at: "2026-01-01T00:00:00Z",
    data: { call_id: "call-1", transcript_url: "https://app.example.test/calls/call-1" },
    id: "call-1_call.ended",
    type: "call.ended",
  };
  assert.deepEqual(webhookEventSchema.parse(event), event);
  assert.equal(webhookEventSchema.safeParse({ ...event, type: "call.turn" }).success, false);
  assert.equal(webhookEndpointUpdateSchema.safeParse({}).success, false);
});
