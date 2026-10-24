import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSuiteFor } from "./default-suite.ts";

const suites = ["accounting-firm", "bright-smile-dental", "electrical"];

test("defaults to the suite named after the agent slug", () => {
  assert.equal(defaultSuiteFor("electrical", suites), "electrical");
  assert.equal(defaultSuiteFor("bright-smile-dental", suites), "bright-smile-dental");
});

test("falls back to the first suite when no suite matches the agent slug", () => {
  assert.equal(defaultSuiteFor("beacon-electrical-services", suites), "accounting-firm");
  assert.equal(defaultSuiteFor(undefined, suites), "accounting-firm");
  assert.equal(defaultSuiteFor("electrical", []), undefined);
});
