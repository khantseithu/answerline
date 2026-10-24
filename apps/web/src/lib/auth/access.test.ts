import assert from "node:assert/strict";
import { test } from "node:test";
import { readOptionalSession } from "./access.ts";

test("skips the session lookup when the request has no cookie", async () => {
  let lookups = 0;
  const session = await readOptionalSession(new Headers(), () => {
    lookups += 1;
    return Promise.resolve({ user: "admin" });
  });
  assert.equal(session, null);
  assert.equal(lookups, 0);
});

test("returns the session resolved for a request with a cookie", async () => {
  const session = await readOptionalSession(new Headers({ cookie: "session=abc" }), async () => ({
    user: "admin",
  }));
  assert.deepEqual(session, { user: "admin" });
});
