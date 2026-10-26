import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { signWebhookPayload } from "./webhooks.ts";

test("webhook signatures cover the timestamp and exact request body", () => {
  const secret = "workspace-secret";
  const timestamp = "1767225600";
  const body = '{"id":"event-1","type":"call.ended"}';
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(signWebhookPayload(secret, timestamp, body), expected);
  assert.notEqual(signWebhookPayload(secret, timestamp, `${body} `), expected);
  assert.notEqual(signWebhookPayload(secret, "1767225601", body), expected);
});
