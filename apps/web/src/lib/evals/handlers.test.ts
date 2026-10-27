import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agents, createDb, evalResults, evalRuns, tenants } from "@answerline/db";
import { type EvalJob, evalExecutionInputSchema, parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { createEvalHandlers } from "./handlers.ts";
import {
  compareEvalRuns,
  type EvalDeps,
  evalJobId,
  getEvalRun,
  listEvalOptions,
} from "./service.ts";
import type { EvalRunView } from "./types.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const SUITE = `- name: books a cleaning
  caller: Can I book a cleaning?
  expect:
    tool_called: check_availability
- name: shares hours
  caller: When are you open?
  expect:
    mentions: [Monday]
`;

interface Harness {
  agentId: string;
  deps: EvalDeps;
  enqueued: EvalJob[];
  handlers: ReturnType<typeof createEvalHandlers>;
  otherAgentId: string;
  otherTenantId: string;
  setEnqueueFailure: (failure: boolean) => void;
}

async function withHarness(run: (harness: Harness) => Promise<void>) {
  const db = createDb();
  const evalsDir = await mkdtemp(join(tmpdir(), "answerline-evals-"));
  const tenantId = crypto.randomUUID();
  const otherTenantId = crypto.randomUUID();
  const enqueued: EvalJob[] = [];
  let failEnqueue = false;
  try {
    await writeFile(join(evalsDir, "dental.yaml"), SUITE);
    await db.insert(tenants).values([
      { id: tenantId, name: "Evals test", slug: `evals-${tenantId}` },
      { id: otherTenantId, name: "Other", slug: `evals-${otherTenantId}` },
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
    const [otherAgent] = await db
      .insert(agents)
      .values({ config, name: "Other agent", slug: "other", tenantId: otherTenantId })
      .returning();
    assert.ok(agent);
    assert.ok(otherAgent);
    const deps: EvalDeps = {
      db,
      enqueue: (job) => {
        if (failEnqueue) {
          return Promise.reject(new Error("redis down"));
        }
        enqueued.push(job);
        return Promise.resolve();
      },
      evalsDir,
      tenantId,
    };
    await run({
      agentId: agent.id,
      deps,
      enqueued,
      handlers: createEvalHandlers(() => Promise.resolve(deps)),
      otherAgentId: otherAgent.id,
      otherTenantId,
      setEnqueueFailure: (failure) => {
        failEnqueue = failure;
      },
    });
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await db.$client.end();
    await rm(evalsDir, { force: true, recursive: true });
  }
}

const post = (body: unknown) =>
  new Request("http://localhost/api/v1/evals", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

async function bodyOf(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function createRun(harness: Harness, input: Record<string, unknown> = {}) {
  const response = await harness.handlers.create(
    post({ agentId: harness.agentId, suite: "dental", ...input })
  );
  assert.equal(response.status, 202);
  return ((await bodyOf(response)) as { run: EvalRunView }).run;
}

test("persists caller audio settings in the snapshot and exposes them on the run", { skip }, () =>
  withHarness(async (harness) => {
    const callerAudio = {
      noiseSnrDb: 18.5,
      profile: "phone",
      seed: 11,
      tts: "cartesia/sonic-2",
      voice: "voice-123",
    };
    const run = await createRun(harness, { callerAudio, mode: "audio" });
    assert.deepEqual(run.callerAudio, callerAudio);
    const [row] = await harness.deps.db.select().from(evalRuns).where(eq(evalRuns.id, run.id));
    assert.deepEqual(row?.executionInput?.callerAudio, callerAudio);

    const defaulted = await createRun(harness, { callerAudio: {}, mode: "audio" });
    assert.deepEqual(defaulted.callerAudio, { profile: "clean", seed: 0 });

    const plain = await createRun(harness);
    assert.equal(plain.callerAudio, null);
  })
);

test("queues a run with an immutable snapshot and a minimal job", { skip }, () =>
  withHarness(async (harness) => {
    const run = await createRun(harness, {
      judgeModel: "anthropic/claude-sonnet-4-5",
      modelOverride: "openai/gpt-4.1-mini",
      sttOverride: "deepgram/nova-2",
      ttsOverride: "cartesia/sonic-2",
    });
    assert.equal(run.status, "queued");
    assert.equal(run.sttOverride, "deepgram/nova-2");
    assert.equal(run.ttsOverride, "cartesia/sonic-2");
    assert.equal(run.avgWer, null);
    assert.equal(run.suite, "dental");
    assert.equal(run.liveTools, false);
    assert.equal(run.mode, "text");
    assert.equal(run.costUsd, null);
    assert.deepEqual(harness.enqueued, [
      { agentId: harness.agentId, runId: run.id, tenantId: harness.deps.tenantId },
    ]);

    const [row] = await harness.deps.db.select().from(evalRuns).where(eq(evalRuns.id, run.id));
    assert.equal(row?.tenantId, harness.deps.tenantId);
    assert.equal(row?.modelOverride, "openai/gpt-4.1-mini");
    assert.equal(row?.executionInput?.agent.name, "Bright Smile Dental");
    assert.deepEqual(
      row?.executionInput?.suite.map((item) => item.name),
      ["books a cleaning", "shares hours"]
    );
    assert.equal(row?.executionInput?.liveTools, false);
    assert.equal(row?.executionInput?.mode, "text");
    assert.equal(row?.executionInput?.modelOverride, "openai/gpt-4.1-mini");
    assert.equal(row?.executionInput?.sttOverride, "deepgram/nova-2");
    assert.equal(row?.executionInput?.ttsOverride, "cartesia/sonic-2");
    assert.equal(row?.executionInput?.judgeModel, "anthropic/claude-sonnet-4-5");
    assert.deepEqual(row?.executionInput?.context, {
      agentSlug: "primary",
      tenantSlug: `evals-${harness.deps.tenantId}`,
    });

    await harness.deps.db
      .update(agents)
      .set({ name: "Renamed" })
      .where(eq(agents.id, harness.agentId));
    const [after] = await harness.deps.db.select().from(evalRuns).where(eq(evalRuns.id, run.id));
    assert.equal(after?.executionInput?.agent.name, "Bright Smile Dental");
  })
);

test("records explicit live tools and audio mode", { skip }, () =>
  withHarness(async (harness) => {
    const run = await createRun(harness, { liveTools: true, mode: "audio" });
    assert.equal(run.liveTools, true);
    assert.equal(run.mode, "audio");
    const [row] = await harness.deps.db.select().from(evalRuns).where(eq(evalRuns.id, run.id));
    assert.equal(row?.executionInput?.liveTools, true);
    assert.deepEqual(row?.executionInput?.context, {
      agentSlug: "primary",
      tenantSlug: `evals-${harness.deps.tenantId}`,
    });
    assert.ok(evalExecutionInputSchema.safeParse(row?.executionInput).success);
  })
);

test("rejects unsafe or unknown suites and invalid bodies", { skip }, () =>
  withHarness(async (harness) => {
    const responses = await Promise.all(
      [
        { agentId: harness.agentId, suite: "../agents/bright-smile-dental" },
        { agentId: harness.agentId, suite: "/etc/passwd" },
        { agentId: harness.agentId, suite: "missing" },
        { agentId: "not-a-uuid", suite: "dental" },
        { agentId: harness.agentId, modelOverride: "gpt", suite: "dental" },
        { agentId: harness.agentId, judgeModel: "claude", suite: "dental" },
        { agentId: harness.agentId, sttOverride: "nova-3", suite: "dental" },
        { agentId: harness.agentId, suite: "dental", ttsOverride: "sonic-3" },
        { agentId: harness.agentId, callerAudio: { noiseSnrDb: 61 }, suite: "dental" },
        { agentId: harness.agentId, callerAudio: { profile: "vinyl" }, suite: "dental" },
        { agentId: harness.agentId, callerAudio: { tts: "sonic-3" }, suite: "dental" },
        "{",
      ].map((body) => harness.handlers.create(post(body)))
    );
    assert.deepEqual(
      responses.map((response) => response.status),
      [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400]
    );
    assert.equal(harness.enqueued.length, 0);
    const rows = await harness.deps.db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.tenantId, harness.deps.tenantId));
    assert.equal(rows.length, 0);
  })
);

test("lists the tenant's agents with their persisted slugs", { skip }, () =>
  withHarness(async (harness) => {
    assert.deepEqual(await listEvalOptions(harness.deps), {
      agents: [{ id: harness.agentId, name: "Bright Smile Dental", slug: "primary" }],
      suites: ["dental"],
    });
  })
);

test("cannot start a run for another tenant's agent", { skip }, () =>
  withHarness(async (harness) => {
    const response = await harness.handlers.create(
      post({ agentId: harness.otherAgentId, suite: "dental" })
    );
    assert.equal(response.status, 404);
    assert.equal(harness.enqueued.length, 0);
  })
);

test("marks the run failed when the queue is unavailable", { skip }, () =>
  withHarness(async (harness) => {
    harness.setEnqueueFailure(true);
    const response = await harness.handlers.create(
      post({ agentId: harness.agentId, suite: "dental" })
    );
    assert.equal(response.status, 503);
    const [row] = await harness.deps.db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.tenantId, harness.deps.tenantId));
    assert.equal(row?.status, "failed");
    assert.equal(row?.error, "Could not queue eval run");
    assert.ok(row?.finishedAt);
  })
);

test("lists and shows only the current tenant's runs", { skip }, () =>
  withHarness(async (harness) => {
    const run = await createRun(harness);
    const [otherRun] = await harness.deps.db
      .insert(evalRuns)
      .values({
        agentId: harness.otherAgentId,
        suite: "dental",
        tenantId: harness.otherTenantId,
      })
      .returning();
    assert.ok(otherRun);
    await harness.deps.db.insert(evalResults).values({
      caseName: "books a cleaning",
      failures: ["did not call check_availability"],
      latencyMs: 820,
      passed: false,
      runId: run.id,
      stageLatency: { llmTtftMs: [310, 420] },
      transcript: [
        { role: "caller", text: "Can I book a cleaning?" },
        { role: "agent", text: "Sure." },
      ],
      wer: 0.125,
    });

    const { runs } = (await bodyOf(await harness.handlers.list())) as { runs: EvalRunView[] };
    assert.deepEqual(
      runs.map((item) => item.id),
      [run.id]
    );

    const detail = await harness.handlers.detail(run.id);
    assert.equal(detail.status, 200);
    const body = (await bodyOf(detail)) as {
      results: {
        caseName: string;
        costUsd: string | null;
        failures: string[];
        wer: number | null;
        stageLatency: { llmTtftMs?: number[] } | null;
      }[];
    };
    assert.equal(body.results[0]?.caseName, "books a cleaning");
    assert.equal(body.results[0]?.costUsd, null);
    assert.equal(body.results[0]?.wer, 0.125);
    assert.deepEqual(body.results[0]?.failures, ["did not call check_availability"]);
    assert.deepEqual(body.results[0]?.stageLatency, { llmTtftMs: [310, 420] });

    assert.equal((await harness.handlers.detail(otherRun.id)).status, 404);
    assert.equal((await harness.handlers.detail("not-a-uuid")).status, 404);
    assert.equal(await getEvalRun(harness.deps, otherRun.id), null);
  })
);

test("compares two tenant runs by case name", { skip }, () =>
  withHarness(async (harness) => {
    const base = await createRun(harness);
    const head = await createRun(harness);
    await harness.deps.db
      .update(evalRuns)
      .set({
        avgLatencyMs: 900,
        avgWer: 0.3,
        costUsd: "0.010000",
        passed: 1,
        stageLatency: { llmTtftMs: { p50: 400, p95: 700 } },
        status: "completed",
        total: 2,
      })
      .where(eq(evalRuns.id, base.id));
    await harness.deps.db
      .update(evalRuns)
      .set({
        avgLatencyMs: 700,
        avgWer: 0.1,
        costUsd: null,
        passed: 2,
        stageLatency: { llmTtftMs: { p50: 300, p95: 650 } },
        status: "completed",
        total: 2,
      })
      .where(eq(evalRuns.id, head.id));
    await harness.deps.db.insert(evalResults).values([
      {
        caseName: "books a cleaning",
        latencyMs: 900,
        passed: false,
        runId: base.id,
        transcript: [],
        wer: 0.3,
      },
      {
        caseName: "shares hours",
        latencyMs: 900,
        passed: true,
        runId: base.id,
        transcript: [],
      },
      {
        caseName: "books a cleaning",
        latencyMs: 600,
        passed: true,
        runId: head.id,
        transcript: [],
        wer: 0.1,
      },
      { caseName: "shares hours", latencyMs: 800, passed: true, runId: head.id, transcript: [] },
    ]);

    const comparison = await compareEvalRuns(harness.deps, base.id, head.id);
    assert.ok(comparison);
    assert.deepEqual(
      comparison.cases.map((item) => [
        item.caseName,
        item.change,
        item.latencyDeltaMs,
        item.werDelta,
      ]),
      [
        ["books a cleaning", "fixed", -300, -0.2],
        ["shares hours", "unchanged", -100, null],
      ]
    );
    assert.deepEqual(comparison.stageLatency, [
      {
        base: { p50: 400, p95: 700 },
        head: { p50: 300, p95: 650 },
        p50DeltaMs: -100,
        p95DeltaMs: -50,
        stage: "llmTtftMs",
      },
    ]);
    assert.deepEqual(comparison.totals, {
      costDeltaUsd: null,
      latencyDeltaMs: -200,
      passRateDelta: 0.5,
      werDelta: -0.2,
    });

    const [foreign] = await harness.deps.db
      .insert(evalRuns)
      .values({ agentId: harness.otherAgentId, suite: "dental", tenantId: harness.otherTenantId })
      .returning();
    assert.ok(foreign);
    assert.equal(await compareEvalRuns(harness.deps, base.id, foreign.id), null);
    assert.equal(await compareEvalRuns(harness.deps, "bad", head.id), null);
  })
);

test("derives a BullMQ-safe job id from the run id", () => {
  const runId = crypto.randomUUID();
  assert.equal(evalJobId(runId), `eval_${runId}`);
  assert.ok(!evalJobId(runId).includes(":"));
});
