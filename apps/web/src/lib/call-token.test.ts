import assert from "node:assert/strict";
import { test } from "node:test";
import { TokenVerifier } from "livekit-server-sdk";
import { AGENT_SLUG_PATTERN, createCallToken } from "./call-token";

const ROOM_NAME = /^call-[0-9a-f-]{36}$/;

test("token joins a fresh room and dispatches the agent with its slug", async () => {
  const details = await createCallToken({
    agentName: "answerline-wt2",
    agentSlug: "bright-smile-dental",
    apiKey: "devkey",
    apiSecret: "secret-secret-secret-secret-secret",
    serverUrl: "ws://localhost:7880",
  });
  const claims = await new TokenVerifier("devkey", "secret-secret-secret-secret-secret").verify(
    details.participantToken
  );

  assert.match(details.roomName, ROOM_NAME);
  assert.equal(claims.video?.room, details.roomName);
  assert.equal(claims.video?.roomJoin, true);
  assert.deepEqual(
    claims.roomConfig?.agents?.map((a) => ({ agentName: a.agentName, metadata: a.metadata })),
    [{ agentName: "answerline-wt2", metadata: JSON.stringify({ agent: "bright-smile-dental" }) }]
  );
});

test("agent slug pattern rejects unsafe values", () => {
  assert.ok(AGENT_SLUG_PATTERN.test("bright-smile-dental"));
  assert.ok(!AGENT_SLUG_PATTERN.test("../etc"));
  assert.ok(!AGENT_SLUG_PATTERN.test("Bright Smile"));
});
