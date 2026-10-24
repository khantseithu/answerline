import assert from "node:assert/strict";
import { test } from "node:test";
import { compareEvalCases, compareEvalTotals, passRate } from "./compare.ts";

const result = (caseName: string, passed: boolean, latencyMs: number | null = 100) => ({
  caseName,
  costUsd: "0.001000",
  latencyMs,
  passed,
});

test("matches cases by name and classifies each change", () => {
  const cases = compareEvalCases(
    [result("books", true, 900), result("hours", false), result("legacy", true)],
    [result("hours", true), result("books", false, 1200), result("new", true)]
  );
  assert.deepEqual(
    cases.map((item) => [item.caseName, item.change, item.latencyDeltaMs]),
    [
      ["books", "regressed", 300],
      ["hours", "fixed", 0],
      ["legacy", "removed", null],
      ["new", "added", null],
    ]
  );
});

test("keeps unchanged cases and leaves unknown latency deltas null", () => {
  const [item] = compareEvalCases([result("books", true, null)], [result("books", true, 500)]);
  assert.equal(item?.change, "unchanged");
  assert.equal(item?.latencyDeltaMs, null);
});

test("uses the first result when a run repeats a case name", () => {
  const [item] = compareEvalCases(
    [result("books", true), result("books", false)],
    [result("books", true)]
  );
  assert.equal(item?.change, "unchanged");
});

test("computes run deltas and keeps unknown cost null", () => {
  assert.deepEqual(
    compareEvalTotals(
      { avgLatencyMs: 800, costUsd: "0.010000", passed: 2, total: 4 },
      { avgLatencyMs: 650, costUsd: "0.012500", passed: 3, total: 4 }
    ),
    { costDeltaUsd: 0.0025, latencyDeltaMs: -150, passRateDelta: 0.25 }
  );
  assert.deepEqual(
    compareEvalTotals(
      { avgLatencyMs: null, costUsd: null, passed: null, total: null },
      { avgLatencyMs: 650, costUsd: "0.012500", passed: 3, total: 4 }
    ),
    { costDeltaUsd: null, latencyDeltaMs: null, passRateDelta: null }
  );
});

test("pass rate is null until a run has totals", () => {
  assert.equal(passRate({ avgLatencyMs: null, costUsd: null, passed: 0, total: 0 }), null);
  assert.equal(passRate({ avgLatencyMs: null, costUsd: null, passed: 1, total: 2 }), 0.5);
});
