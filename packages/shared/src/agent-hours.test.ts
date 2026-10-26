import assert from "node:assert/strict";
import { test } from "node:test";
import { isWithinCallingHours } from "./agent-hours.ts";

const hours = {
  after_hours: "voicemail" as const,
  holidays: [],
  timezone: "UTC",
  weekdays: "09:00-17:00",
};

test("calling hours use the agent timezone and opening boundaries", () => {
  assert.equal(isWithinCallingHours(hours, new Date("2026-10-26T09:00:00Z")), true);
  assert.equal(isWithinCallingHours(hours, new Date("2026-10-26T16:59:00Z")), true);
  assert.equal(isWithinCallingHours(hours, new Date("2026-10-26T17:00:00Z")), false);
});

test("holiday hours override the weekly schedule, including a full-day closure", () => {
  assert.equal(
    isWithinCallingHours(
      { ...hours, holidays: [{ date: "2026-10-26" }] },
      new Date("2026-10-26T12:00:00Z")
    ),
    false
  );
  assert.equal(
    isWithinCallingHours(
      { ...hours, holidays: [{ date: "2026-10-26", hours: "11:00-13:00" }] },
      new Date("2026-10-26T12:00:00Z")
    ),
    true
  );
});

test("overnight hours include the previous day's window", () => {
  assert.equal(
    isWithinCallingHours(
      { ...hours, weekdays: "22:00-02:00", weekends: "22:00-02:00" },
      new Date("2026-10-26T01:00:00Z")
    ),
    true
  );
});

test("invalid timezones fail closed", () => {
  assert.equal(isWithinCallingHours({ ...hours, timezone: "Not/A_Timezone" }, new Date()), false);
});
