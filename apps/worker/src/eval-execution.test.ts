import assert from "node:assert/strict";
import { test } from "node:test";
import { describeRunnerFailure } from "./eval-execution.ts";

test("describeRunnerFailure shows the message from a JSON error line", () => {
  const stderr = `${JSON.stringify({ error: "business_hours requires an hours configuration" })}\n`;
  assert.equal(
    describeRunnerFailure(1, stderr),
    "eval runner exited with status 1: business_hours requires an hours configuration"
  );
});

test("describeRunnerFailure prefers the last JSON error line over earlier log output", () => {
  const stderr = `warming up\n${JSON.stringify({ error: "first" })}\n${JSON.stringify({ error: "second" })}\n`;
  assert.equal(describeRunnerFailure(1, stderr), "eval runner exited with status 1: second");
});

test("describeRunnerFailure falls back to trimmed stderr when it is not JSON", () => {
  assert.equal(
    describeRunnerFailure(2, "\n  Traceback: boom\n\n"),
    "eval runner exited with status 2: Traceback: boom"
  );
});

test("describeRunnerFailure keeps the tail of long non-JSON stderr", () => {
  const stderr = `${"a".repeat(2000)}the real reason`;
  const message = describeRunnerFailure(1, stderr);
  assert.ok(message.endsWith("the real reason"));
  assert.ok(message.length < 600);
});

test("describeRunnerFailure caps long JSON error messages", () => {
  const stderr = JSON.stringify({ error: "x".repeat(2000) });
  assert.ok(describeRunnerFailure(1, stderr).length < 600);
});

test("describeRunnerFailure keeps the bare status when stderr is empty", () => {
  assert.equal(describeRunnerFailure(1, " \n"), "eval runner exited with status 1");
  assert.equal(describeRunnerFailure(null, ""), "eval runner exited with status unknown");
});
