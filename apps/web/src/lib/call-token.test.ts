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
    tenantSlug: "workspace-two",
  });
  const claims = await new TokenVerifier("devkey", "secret-secret-secret-secret-secret").verify(
    details.participantToken
  );

  assert.match(details.roomName, ROOM_NAME);
  assert.equal(claims.video?.room, details.roomName);
  assert.equal(claims.video?.roomJoin, true);
  assert.deepEqual(
    claims.roomConfig?.agents?.map((a) => ({ agentName: a.agentName, metadata: a.metadata })),
    [
      {
        agentName: "answerline-wt2",
        metadata: JSON.stringify({ agent: "bright-smile-dental", tenant: "workspace-two" }),
      },
    ]
  );
});

test("agent slug pattern rejects unsafe values", () => {
  assert.ok(AGENT_SLUG_PATTERN.test("bright-smile-dental"));
  assert.ok(!AGENT_SLUG_PATTERN.test("../etc"));
  assert.ok(!AGENT_SLUG_PATTERN.test("Bright Smile"));
});

test("identical agent slugs dispatch to distinct workspaces", async () => {
  const claims = await Promise.all(
    ["first", "second"].map(async (tenantSlug) => {
      const details = await createCallToken({
        agentName: "answerline",
        agentSlug: "desk",
        apiKey: "devkey",
        apiSecret: "secret-secret-secret-secret-secret",
        serverUrl: "ws://localhost:7880",
        tenantSlug,
      });
      return new TokenVerifier("devkey", "secret-secret-secret-secret-secret").verify(
        details.participantToken
      );
    })
  );
  assert.deepEqual(
    claims.map((claim) => JSON.parse(claim.roomConfig?.agents?.[0]?.metadata ?? "")),
    [
      { agent: "desk", tenant: "first" },
      { agent: "desk", tenant: "second" },
    ]
  );
});
