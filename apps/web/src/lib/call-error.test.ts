import assert from "node:assert/strict";
import test from "node:test";
import { callSetupErrorDescription } from "./call-error.ts";

const denied = /Microphone access was denied.*system privacy settings/;
const missing = /No microphone was found/;
const unreadable = /microphone could not be opened/;
const connection = /Check that LiveKit is running/;

test("microphone failures explain how to recover", () => {
  assert.match(
    callSetupErrorDescription(new DOMException("Permission denied", "NotAllowedError")),
    denied
  );
  assert.match(callSetupErrorDescription(new DOMException("No device", "NotFoundError")), missing);
  assert.match(
    callSetupErrorDescription(new DOMException("Device busy", "NotReadableError")),
    unreadable
  );
});

test("connection failures preserve the actual error", () => {
  assert.equal(
    callSetupErrorDescription(new Error("WebSocket connection failed")),
    "WebSocket connection failed"
  );
  assert.match(callSetupErrorDescription(undefined), connection);
});
