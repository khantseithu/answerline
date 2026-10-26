import assert from "node:assert/strict";
import { test } from "node:test";
import { createWebhookHandlers } from "./handlers";

test("webhook mutations reject cross-origin requests before resolving workspace services", async () => {
  let resolved = false;
  const handlers = createWebhookHandlers(() => {
    resolved = true;
    return Promise.reject(new Error("workspace services should not be loaded"));
  });
  const response = await handlers.create(
    new Request("http://localhost:3000/api/v1/webhooks", {
      body: "{}",
      headers: { origin: "https://attacker.example" },
      method: "POST",
    })
  );
  assert.equal(response.status, 403);
  assert.equal(resolved, false);
});

test("malformed webhook JSON returns 400 before resolving workspace services", async () => {
  let resolved = false;
  const handlers = createWebhookHandlers(() => {
    resolved = true;
    return Promise.reject(new Error("workspace services should not be loaded"));
  });
  const response = await handlers.create(
    new Request("http://localhost:3000/api/v1/webhooks", {
      body: "{",
      headers: { origin: "http://localhost:3000" },
      method: "POST",
    })
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Request body must be JSON" });
  assert.equal(resolved, false);
});
