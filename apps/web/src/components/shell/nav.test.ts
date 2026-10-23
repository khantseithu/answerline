import assert from "node:assert/strict";
import { test } from "node:test";
import { isActive } from "./nav";

test("overview is active only on the root path", () => {
  assert.equal(isActive("/", "/"), true);
  assert.equal(isActive("/calls", "/"), false);
});

test("sections stay active on nested paths", () => {
  assert.equal(isActive("/calls", "/calls"), true);
  assert.equal(isActive("/calls/abc123", "/calls"), true);
});

test("sections do not match paths that only share a prefix", () => {
  assert.equal(isActive("/callsheet", "/calls"), false);
  assert.equal(isActive("/agents", "/calls"), false);
});
