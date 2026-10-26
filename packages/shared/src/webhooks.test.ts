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
  const callId = "00000000-0000-4000-8000-000000000001";
  const event = {
    created_at: "2026-01-01T00:00:00Z",
    data: {
      agent: "front-desk",
      call_id: callId,
      duration_ms: 15_000,
      ended_at: "2026-01-01T00:00:15Z",
      status: "completed",
      transcript_url: `https://app.example.test/api/v1/calls/${callId}`,
    },
    id: "call-1_call.ended",
    type: "call.ended",
  };
  assert.deepEqual(webhookEventSchema.parse(event), event);
  assert.equal(webhookEventSchema.safeParse({ ...event, type: "call.turn" }).success, false);
  assert.equal(webhookEndpointUpdateSchema.safeParse({}).success, false);
});

test("webhook event schemas validate booking, eval, and lead payloads", () => {
  const callId = "00000000-0000-4000-8000-000000000001";
  const agentId = "00000000-0000-4000-8000-000000000002";
  const id = "00000000-0000-4000-8000-000000000003";
  const shared = { created_at: "2026-01-01T00:00:00Z", id: "event-1" };
  const evalEvent = {
    ...shared,
    data: {
      agent_id: agentId,
      avg_latency_ms: 800,
      cost_usd: 0.01,
      eval_run_id: id,
      passed: 2,
      status: "completed",
      suite: "smoke",
      total: 3,
    },
    type: "eval.completed",
  };
  const events = [
    {
      ...shared,
      data: {
        agent_id: agentId,
        call_id: callId,
        name: "Alex Caller",
        starts_at: "2026-01-02T10:00:00Z",
      },
      type: "booking.created",
    },
    evalEvent,
    {
      ...shared,
      data: {
        agent: "front-desk",
        call_id: callId,
        lead_id: id,
        name: "Alex Caller",
        phone: "+15555550123",
        reason: "Schedule a cleaning",
      },
      type: "lead.created",
    },
  ];
  for (const event of events) {
    assert.deepEqual(webhookEventSchema.parse(event), event);
  }
  assert.equal(
    webhookEventSchema.safeParse({
      ...evalEvent,
      data: { ...evalEvent.data, passed: null },
    }).success,
    false
  );
});
