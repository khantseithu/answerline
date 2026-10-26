import assert from "node:assert/strict";
import { test } from "node:test";
import { type CallEventJob, callEventJob } from "@answerline/shared";
import { toWebhookEvent } from "./call-events.ts";

test("call ended webhooks include a tenant-call resource URL and stable event id", () => {
  const event = callEventJob.parse({
    agent: "front-desk",
    duration_ms: 15_000,
    ended_at: "2026-01-01T00:00:15Z",
    room_name: "call-room-1",
    status: "completed",
    tenant: "clinic",
    type: "call.ended",
  }) satisfies CallEventJob;
  assert.deepEqual(
    toWebhookEvent(event, "00000000-0000-4000-8000-000000000001", "https://answerline.test/"),
    {
      created_at: "2026-01-01T00:00:15Z",
      data: {
        agent: "front-desk",
        call_id: "00000000-0000-4000-8000-000000000001",
        duration_ms: 15_000,
        ended_at: "2026-01-01T00:00:15Z",
        status: "completed",
        transcript_url: "https://answerline.test/api/v1/calls/00000000-0000-4000-8000-000000000001",
      },
      id: "call-room-1_call.ended",
      type: "call.ended",
    }
  );
});

test("non-public call events do not create webhook events", () => {
  const event = callEventJob.parse({
    agent: "front-desk",
    role: "caller",
    room_name: "call-room-1",
    seq: 0,
    started_at: "2026-01-01T00:00:00Z",
    tenant: "clinic",
    text: "Hi",
    type: "call.turn",
  });
  assert.equal(toWebhookEvent(event, "call-id"), undefined);
});
