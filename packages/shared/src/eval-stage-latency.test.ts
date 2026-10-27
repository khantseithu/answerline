import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatStageLatency,
  nearestRankPercentile,
  summarizeStageLatency,
} from "./eval-stage-latency.ts";

test("nearest-rank percentile handles empty, single, unsorted, and tied samples", () => {
  assert.equal(nearestRankPercentile([], 50), null);
  assert.equal(nearestRankPercentile([120], 50), 120);
  assert.equal(nearestRankPercentile([120], 95), 120);
  assert.equal(nearestRankPercentile([400, 100, 300, 200], 50), 200);
  assert.equal(nearestRankPercentile([400, 100, 300, 200], 95), 400);
  assert.equal(nearestRankPercentile([5, 5, 5], 95), 5);
  assert.equal(nearestRankPercentile([1, 2, 3], 0), 1);
  assert.equal(nearestRankPercentile([1, 2, 3], 100), 3);
});

test("nearest-rank percentile does not mutate its input", () => {
  const samples = [3, 1, 2];
  nearestRankPercentile(samples, 50);
  assert.deepEqual(samples, [3, 1, 2]);
});

test("nearest-rank percentile of 20 samples picks the 19th for p95", () => {
  const samples = Array.from({ length: 20 }, (_, index) => (index + 1) * 10);
  assert.equal(nearestRankPercentile(samples, 50), 100);
  assert.equal(nearestRankPercentile(samples, 95), 190);
});

test("summarizes stages across all turns of all cases and omits empty stages", () => {
  assert.deepEqual(
    summarizeStageLatency([
      { llmTotalMs: [900, 1100], llmTtftMs: [300, 500] },
      undefined,
      { llmTotalMs: [700], llmTtftMs: [400], sttMs: [150] },
    ]),
    {
      llmTotalMs: { p50: 900, p95: 1100 },
      llmTtftMs: { p50: 400, p95: 500 },
      sttMs: { p50: 150, p95: 150 },
    }
  );
});

test("returns null when no case has samples", () => {
  assert.equal(summarizeStageLatency([]), null);
  assert.equal(summarizeStageLatency([undefined, null, {}, { sttMs: [] }]), null);
});

test("formats a compact p50/p95 line in stage order and skips missing stages", () => {
  assert.equal(formatStageLatency(null), null);
  assert.equal(formatStageLatency({}), null);
  assert.equal(
    formatStageLatency({
      llmTtftMs: { p50: 320, p95: 510 },
      sttMs: { p50: 150, p95: 210 },
      ttsTtfbMs: { p50: 90, p95: 120 },
    }),
    "STT 150/210 ms · LLM TTFT 320/510 ms · TTS TTFB 90/120 ms (p50/p95)"
  );
});
