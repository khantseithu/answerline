import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentConfig } from "@answerline/shared";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "./client.ts";
import {
  agents,
  bookings,
  calls,
  callTurns,
  evalResults,
  evalRuns,
  knowledgeChunks,
  knowledgeSources,
  leads,
  tenants,
  toolCalls,
  voicemails,
} from "./schema.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

function isForeignKeyViolation(error: unknown) {
  return (
    error instanceof Error &&
    error.cause instanceof Error &&
    "code" in error.cause &&
    error.cause.code === "23503"
  );
}

async function withWorkspaces(
  run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>
) {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await fixture.db
      .delete(tenants)
      .where(inArray(tenants.id, [fixture.first.id, fixture.second.id]));
    await fixture.db.$client.end();
  }
}

async function createFixture() {
  const db = createDb();
  const id = crypto.randomUUID();
  const [first, second] = await db
    .insert(tenants)
    .values([
      { name: "First", slug: `first-${id}` },
      { name: "Second", slug: `second-${id}` },
    ])
    .returning();
  assert.ok(first && second);
  const config = parseAgentConfig(
    await readFile(new URL("../../../agents/bright-smile-dental.yaml", import.meta.url), "utf8")
  );
  const [agent, foreignAgent, otherAgent] = await db
    .insert(agents)
    .values([
      { config, name: "First", slug: "dental", tenantId: first.id },
      { config, name: "Second", slug: "dental", tenantId: second.id },
      { config, name: "Other", slug: "other", tenantId: first.id },
    ])
    .returning();
  assert.ok(agent && foreignAgent && otherAgent);
  const [call] = await db
    .insert(calls)
    .values({
      agentId: agent.id,
      channel: "web",
      roomName: `room-${id}`,
      startedAt: new Date(),
      tenantId: first.id,
    })
    .returning();
  const [source] = await db
    .insert(knowledgeSources)
    .values({ agentId: agent.id, tenantId: first.id, type: "text" })
    .returning();
  assert.ok(call && source);
  return { agent, call, db, first, foreignAgent, otherAgent, second, source };
}

test("tenant-owned references reject another workspace's parents", { skip }, () =>
  withWorkspaces(async ({ db, first, second, agent, foreignAgent, call, source }) => {
    const callData = {
      agentId: foreignAgent.id,
      channel: "web",
      roomName: `invalid-${crypto.randomUUID()}`,
      startedAt: new Date(),
      tenantId: first.id,
    } as const;
    const booking = {
      agentId: foreignAgent.id,
      name: "Alex",
      provider: "native",
      startsAt: new Date(),
      tenantId: first.id,
    };
    const lead = {
      agentId: foreignAgent.id,
      callId: call.id,
      name: "Alex",
      phone: "+15555550123",
      reason: "Question",
      tenantId: first.id,
    };
    const voicemail = {
      agentId: foreignAgent.id,
      callId: call.id,
      message: "Call back",
      tenantId: first.id,
    };
    await Promise.all([
      assert.rejects(db.insert(calls).values(callData), isForeignKeyViolation),
      assert.rejects(
        db
          .insert(knowledgeSources)
          .values({ agentId: foreignAgent.id, tenantId: first.id, type: "text" }),
        isForeignKeyViolation
      ),
      assert.rejects(
        db
          .insert(knowledgeChunks)
          .values({ content: "Private", seq: 0, sourceId: source.id, tenantId: second.id }),
        isForeignKeyViolation
      ),
      assert.rejects(db.insert(bookings).values(booking), isForeignKeyViolation),
      assert.rejects(
        db
          .insert(bookings)
          .values({ ...booking, agentId: foreignAgent.id, callId: call.id, tenantId: second.id }),
        isForeignKeyViolation
      ),
      assert.rejects(db.insert(leads).values(lead), isForeignKeyViolation),
      assert.rejects(
        db.insert(leads).values({ ...lead, tenantId: second.id }),
        isForeignKeyViolation
      ),
      assert.rejects(db.insert(voicemails).values(voicemail), isForeignKeyViolation),
      assert.rejects(
        db.insert(voicemails).values({ ...voicemail, tenantId: second.id }),
        isForeignKeyViolation
      ),
      assert.rejects(
        db.insert(evalRuns).values({ agentId: foreignAgent.id, suite: "test", tenantId: first.id }),
        isForeignKeyViolation
      ),
      assert.rejects(
        db.update(calls).set({ tenantId: second.id }).where(eq(calls.id, call.id)),
        isForeignKeyViolation
      ),
      assert.rejects(
        db
          .update(knowledgeSources)
          .set({ tenantId: second.id })
          .where(eq(knowledgeSources.id, source.id)),
        isForeignKeyViolation
      ),
      assert.rejects(
        db
          .update(agents)
          .set({ slug: "moved", tenantId: second.id })
          .where(eq(agents.id, agent.id)),
        isForeignKeyViolation
      ),
    ]);
  })
);

test("call-linked records reject another agent in the same workspace", { skip }, () =>
  withWorkspaces(async ({ db, first, otherAgent, call }) => {
    const ref = { agentId: otherAgent.id, callId: call.id, tenantId: first.id };
    await Promise.all([
      assert.rejects(
        db
          .insert(bookings)
          .values({ ...ref, name: "Alex", provider: "native", startsAt: new Date() }),
        isForeignKeyViolation
      ),
      assert.rejects(
        db
          .insert(leads)
          .values({ ...ref, name: "Alex", phone: "+15555550123", reason: "Question" }),
        isForeignKeyViolation
      ),
      assert.rejects(
        db.insert(voicemails).values({ ...ref, message: "Call back" }),
        isForeignKeyViolation
      ),
    ]);
  })
);

test(
  "same-workspace links preserve call deletion, agent cascades, and tenant-wide knowledge",
  { skip },
  () =>
    withWorkspaces(async ({ db, first, agent, call, source }) => {
      const ref = { agentId: agent.id, callId: call.id, tenantId: first.id };
      const [booking] = await db
        .insert(bookings)
        .values({ ...ref, name: "Alex", provider: "native", startsAt: new Date() })
        .returning();
      assert.ok(booking);
      await db
        .insert(leads)
        .values({ ...ref, name: "Alex", phone: "+15555550123", reason: "Question" });
      await db.insert(voicemails).values({ ...ref, message: "Call back" });
      await db
        .insert(callTurns)
        .values({ callId: call.id, role: "caller", seq: 0, startedAt: new Date(), text: "Hello" });
      await db
        .insert(toolCalls)
        .values({ args: {}, callId: call.id, name: "search", seq: 0, status: "ok" });
      const [run] = await db
        .insert(evalRuns)
        .values({ agentId: agent.id, suite: "test", tenantId: first.id })
        .returning();
      assert.ok(run);
      await db
        .insert(evalResults)
        .values({ caseName: "greeting", passed: true, runId: run.id, transcript: [] });
      await db
        .insert(knowledgeChunks)
        .values({ content: "Private", seq: 0, sourceId: source.id, tenantId: first.id });
      const [sharedSource] = await db
        .insert(knowledgeSources)
        .values({ tenantId: first.id, type: "text" })
        .returning();
      assert.ok(sharedSource);
      await db
        .insert(knowledgeChunks)
        .values({ content: "Shared", seq: 0, sourceId: sharedSource.id, tenantId: first.id });

      await db.delete(calls).where(eq(calls.id, call.id));
      const [storedBooking] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
      assert.ok(storedBooking);
      assert.equal(storedBooking.callId, null);
      assert.equal(storedBooking.agentId, agent.id);
      assert.equal(storedBooking.tenantId, first.id);
      assert.deepEqual(await db.select().from(leads).where(eq(leads.callId, call.id)), []);
      assert.deepEqual(
        await db.select().from(voicemails).where(eq(voicemails.callId, call.id)),
        []
      );
      assert.deepEqual(await db.select().from(callTurns).where(eq(callTurns.callId, call.id)), []);
      assert.deepEqual(await db.select().from(toolCalls).where(eq(toolCalls.callId, call.id)), []);

      await db.delete(agents).where(eq(agents.id, agent.id));
      assert.deepEqual(await db.select().from(bookings).where(eq(bookings.id, booking.id)), []);
      assert.deepEqual(
        await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, source.id)),
        []
      );
      assert.deepEqual(
        await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, source.id)),
        []
      );
      assert.deepEqual(await db.select().from(evalRuns).where(eq(evalRuns.id, run.id)), []);
      assert.deepEqual(
        await db.select().from(evalResults).where(eq(evalResults.runId, run.id)),
        []
      );
      assert.equal(
        (await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, sharedSource.id)))
          .length,
        1
      );
      await db.delete(tenants).where(eq(tenants.id, first.id));
      assert.deepEqual(
        await db
          .select()
          .from(knowledgeChunks)
          .where(eq(knowledgeChunks.sourceId, sharedSource.id)),
        []
      );
    })
);
