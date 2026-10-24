import assert from "node:assert/strict";
import { test } from "node:test";
import { activeTurnIndex, formatOffset, turnOffsetSeconds } from "./playback.ts";

test("turn offsets are measured from the recording start, not the call start", () => {
  const recordingStart = new Date("2026-10-24T10:00:00.000Z");
  const turnStart = new Date("2026-10-24T10:00:12.500Z");
  assert.equal(turnOffsetSeconds(turnStart, recordingStart), 12.5);
});

test("turns without a recording origin or before it have no seek offset", () => {
  const turnStart = new Date("2026-10-24T10:00:12.500Z");
  assert.equal(turnOffsetSeconds(turnStart, null), null);
  assert.equal(turnOffsetSeconds(turnStart, new Date("2026-10-24T10:00:13.000Z")), null);
});

test("the active turn is the last turn that has started by the current time", () => {
  const offsets = [0, 4.2, null, 9];
  assert.equal(activeTurnIndex(offsets, -1), -1);
  assert.equal(activeTurnIndex(offsets, 0), 0);
  assert.equal(activeTurnIndex(offsets, 5), 1);
  assert.equal(activeTurnIndex(offsets, 9.5), 3);
});

test("turns without offsets are never active", () => {
  assert.equal(activeTurnIndex([null, null], 30), -1);
});

test("offsets format as m:ss and h:mm:ss", () => {
  assert.equal(formatOffset(0), "0:00");
  assert.equal(formatOffset(65.9), "1:05");
  assert.equal(formatOffset(3725), "1:02:05");
  assert.equal(formatOffset(-3), "0:00");
});
