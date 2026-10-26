import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, createDb, tenants } from "@answerline/db";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { TokenVerifier } from "livekit-server-sdk";
import { createCallTokenHandler } from "./call-token-handler";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const options = {
  agentName: "answerline",
  apiKey: "devkey",
  apiSecret: "secret-secret-secret-secret-secret",
  serverUrl: "ws://localhost:7880",
};

test("call token requests reject other-workspace agents and dispatch the active workspace", {
  skip,
}, async () => {
  const db = createDb();
  const id = crypto.randomUUID();
  const workspaceSlug = `token-${id}`;
  const foreignSlug = `token-foreign-${id}`;
  const workspaceId = crypto.randomUUID();
  const foreignId = crypto.randomUUID();
  try {
    await db.insert(tenants).values([
      { id: workspaceId, name: workspaceSlug, slug: workspaceSlug },
      { id: foreignId, name: foreignSlug, slug: foreignSlug },
    ]);
    const config = parseAgentConfig(
      await readFile(
        new URL("../../../../agents/bright-smile-dental.yaml", import.meta.url),
        "utf8"
      )
    );
    await db.insert(agents).values([
      { config, name: config.name, slug: "desk", tenantId: workspaceId },
      { config, name: config.name, slug: "desk", tenantId: foreignId },
      { config, name: config.name, slug: "foreign-only", tenantId: foreignId },
      {
        archivedAt: new Date(),
        config,
        name: config.name,
        slug: "archived",
        tenantId: workspaceId,
      },
    ]);
    const handler = createCallTokenHandler(
      () => Promise.resolve({ db, role: "owner", tenantId: workspaceId }),
      options
    );
    const response = await handler(new Request("http://localhost/api/v1/token?agent=desk"));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { participantToken: string };
    const claims = await new TokenVerifier(options.apiKey, options.apiSecret).verify(
      body.participantToken
    );
    assert.deepEqual(JSON.parse(claims.roomConfig?.agents?.[0]?.metadata ?? ""), {
      agent: "desk",
      tenant: workspaceSlug,
    });
    assert.equal(
      (await handler(new Request("http://localhost/api/v1/token?agent=foreign-only"))).status,
      404
    );
    assert.equal(
      (await handler(new Request("http://localhost/api/v1/token?agent=archived"))).status,
      404
    );
    assert.equal(
      (await handler(new Request("http://localhost/api/v1/token?agent=../foreign-only"))).status,
      400
    );
    const viewerHandler = createCallTokenHandler(
      () => Promise.resolve({ db, role: "viewer", tenantId: workspaceId }),
      options
    );
    assert.equal(
      (await viewerHandler(new Request("http://localhost/api/v1/token?agent=desk"))).status,
      403
    );
  } finally {
    await db.delete(tenants).where(eq(tenants.id, workspaceId));
    await db.delete(tenants).where(eq(tenants.id, foreignId));
    await db.$client.end();
  }
});
