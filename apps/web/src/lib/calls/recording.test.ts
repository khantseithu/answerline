import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, calls, createDb, tenants } from "@answerline/db";
import { parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import {
  createRecordingStorage,
  getCallRecordingUrl,
  parseRecordingUrl,
  type RecordingStorage,
} from "./recording.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

const fakeStorage: RecordingStorage = {
  bucket: "recordings",
  presignGet: (key) => Promise.resolve(`https://signed.example/${key}?sig=test`),
};

async function withRecordedCall(
  run: (input: {
    db: ReturnType<typeof createDb>;
    callId: string;
    tenantId: string;
    otherTenantId: string;
  }) => Promise<void>
) {
  const db = createDb();
  const tenantId = crypto.randomUUID();
  const otherTenantId = crypto.randomUUID();
  try {
    await db.insert(tenants).values([
      { id: tenantId, name: `rec-${tenantId}`, slug: `rec-${tenantId}` },
      { id: otherTenantId, name: `rec-${otherTenantId}`, slug: `rec-${otherTenantId}` },
    ]);
    const config = parseAgentConfig(
      await readFile(
        new URL("../../../../../agents/bright-smile-dental.yaml", import.meta.url),
        "utf8"
      )
    );
    const [agent] = await db
      .insert(agents)
      .values({ config, name: config.name, slug: "primary", tenantId })
      .returning();
    assert.ok(agent);
    const [call] = await db
      .insert(calls)
      .values({
        agentId: agent.id,
        channel: "web",
        recordingUrl: `s3://recordings/${tenantId}/call-1.ogg`,
        roomName: `rec-${crypto.randomUUID()}`,
        tenantId,
      })
      .returning();
    assert.ok(call);
    await run({ callId: call.id, db, otherTenantId, tenantId });
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await db.$client.end();
  }
}

test("recording URL is presigned only for the owning tenant", { skip }, () =>
  withRecordedCall(async ({ db, callId, otherTenantId, tenantId }) => {
    assert.equal(
      await getCallRecordingUrl(db, tenantId, callId, fakeStorage),
      `https://signed.example/${tenantId}/call-1.ogg?sig=test`
    );
    assert.equal(await getCallRecordingUrl(db, otherTenantId, callId, fakeStorage), null);
  })
);

test(
  "recording lookup returns null for unknown, malformed, or bucket-mismatched ids",
  { skip },
  () =>
    withRecordedCall(async ({ db, callId, tenantId }) => {
      assert.equal(await getCallRecordingUrl(db, tenantId, MISSING_ID, fakeStorage), null);
      assert.equal(await getCallRecordingUrl(db, tenantId, "not-a-uuid", fakeStorage), null);
      const otherBucket: RecordingStorage = { ...fakeStorage, bucket: "elsewhere" };
      assert.equal(await getCallRecordingUrl(db, tenantId, callId, otherBucket), null);
    })
);

test("recording lookup returns null when the call has no recording", { skip }, () =>
  withRecordedCall(async ({ db, tenantId }) => {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.tenantId, tenantId));
    assert.ok(agent);
    const [bare] = await db
      .insert(calls)
      .values({
        agentId: agent.id,
        channel: "web",
        roomName: `bare-${crypto.randomUUID()}`,
        tenantId,
      })
      .returning();
    assert.ok(bare);
    assert.equal(await getCallRecordingUrl(db, tenantId, bare.id, fakeStorage), null);
  })
);

test("parses s3 recording URLs and rejects unsafe keys", () => {
  assert.deepEqual(parseRecordingUrl("s3://recordings/acme/call-1.ogg"), {
    bucket: "recordings",
    key: "acme/call-1.ogg",
  });
  assert.equal(parseRecordingUrl("https://example.com/call.ogg"), null);
  assert.equal(parseRecordingUrl("s3://recordings/"), null);
  assert.equal(parseRecordingUrl("s3://recordings/../secrets.ogg"), null);
  assert.equal(parseRecordingUrl("s3://recordings//absolute.ogg"), null);
});

test("presigned URLs are signed with a short expiry and no network call", async () => {
  const storage = createRecordingStorage({
    accessKeyId: "answerline",
    bucket: "recordings",
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    secretAccessKey: "answerline-secret",
  });
  const url = new URL(await storage.presignGet("acme/call-1.ogg"));
  assert.equal(url.host, "localhost:9000");
  assert.equal(url.pathname, "/recordings/acme/call-1.ogg");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
});
