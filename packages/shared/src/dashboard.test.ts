import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callsListQuerySchema,
  createAgentSchema,
  postCallAnalysisSchema,
  postCallJobSchema,
  updateAgentSchema,
} from "./dashboard.ts";
import { modelUsageSchema } from "./model-usage.ts";

const config = {
  greeting: "Hello",
  instructions: "Be brief",
  models: {
    llm: { primary: "openai/gpt-4.1-mini" },
    stt: "deepgram/nova-3",
    tts: "cartesia/sonic-3",
  },
  name: "Reception",
};

test("call filters parse URL values and bound pagination and date ranges", () => {
  assert.deepEqual(callsListQuerySchema.parse({}), { page: 1, pageSize: 25 });
  assert.equal(callsListQuerySchema.parse({ page: "2", pageSize: "100", q: " hello " }).q, "hello");
  for (const query of [
    { page: "0" },
    { pageSize: "101" },
    { from: "2026-02-30" },
    { from: "2026-10-24", to: "2026-10-23" },
    { agentId: "../another-tenant" },
    { channel: "email" },
  ]) {
    assert.equal(callsListQuerySchema.safeParse(query).success, false);
  }
});

test("agent writes require valid config, safe slugs, and optimistic versions", () => {
  assert.equal(createAgentSchema.parse({ config, slug: "front-desk" }).config.name, config.name);
  assert.equal(updateAgentSchema.parse({ config, version: 1 }).version, 1);
  assert.equal(createAgentSchema.safeParse({ config, slug: "../config" }).success, false);
  assert.equal(updateAgentSchema.safeParse({ config, version: 0 }).success, false);
  assert.equal(updateAgentSchema.safeParse({ config }).success, false);
  assert.equal(
    createAgentSchema.safeParse({ config: { ...config, unsupported: true }, slug: "x" }).success,
    false
  );
});

test("post-call jobs require both call and tenant identity and validated analysis", () => {
  assert.equal(postCallJobSchema.safeParse({ callId: crypto.randomUUID() }).success, false);
  assert.equal(
    postCallJobSchema.safeParse({ callId: crypto.randomUUID(), tenantId: crypto.randomUUID() })
      .success,
    true
  );
  assert.equal(
    postCallAnalysisSchema.safeParse({
      outcome: "booked",
      sentiment: "positive",
      summary: "Caller booked a visit",
    }).success,
    true
  );
  assert.equal(
    postCallAnalysisSchema.safeParse({ outcome: "made-up", sentiment: "happy", summary: "" })
      .success,
    false
  );
});

test("usage quantities and units are tied to their model stage", () => {
  assert.equal(
    modelUsageSchema.safeParse({
      model: "nova-3",
      provider: "deepgram",
      quantity: 12.5,
      stage: "stt",
      unit: "seconds",
    }).success,
    true
  );
  for (const usage of [
    { quantity: 0.5, stage: "llm", unit: "input_tokens" },
    { quantity: 5, stage: "tts", unit: "seconds" },
    { quantity: -1, stage: "stt", unit: "seconds" },
  ]) {
    assert.equal(
      modelUsageSchema.safeParse({ model: "test", provider: "test", ...usage }).success,
      false
    );
  }
});
