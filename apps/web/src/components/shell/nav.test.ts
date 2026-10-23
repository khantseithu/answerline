import assert from "node:assert/strict";
import { test } from "node:test";
import { isActive } from "./nav";

test("overview is active only on its path", () => {
  assert.equal(isActive("/overview", "/overview"), true);
  assert.equal(isActive("/calls", "/overview"), false);
});

test("sections stay active on nested paths", () => {
  assert.equal(isActive("/calls", "/calls"), true);
  assert.equal(isActive("/calls/abc123", "/calls"), true);
});

test("sections do not match paths that only share a prefix", () => {
  assert.equal(isActive("/callsheet", "/calls"), false);
  assert.equal(isActive("/agents", "/calls"), false);
});
