import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agents, createDb, evalResults, evalRuns, tenants } from "@answerline/db";
import { type EvalJob, evalExecutionInputSchema, parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { createEvalHandlers } from "./handlers.ts";
import { compareEvalRuns, type EvalDeps, evalJobId, getEvalRun } from "./service.ts";
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

test("queues a run with an immutable snapshot and a minimal job", { skip }, () =>
  withHarness(async (harness) => {
    const run = await createRun(harness, { modelOverride: "openai/gpt-4.1-mini" });
    assert.equal(run.status, "queued");
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
        "{",
      ].map((body) => harness.handlers.create(post(body)))
    );
    assert.deepEqual(
      responses.map((response) => response.status),
      [400, 400, 400, 400, 400, 400]
    );
    assert.equal(harness.enqueued.length, 0);
    const rows = await harness.deps.db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.tenantId, harness.deps.tenantId));
    assert.equal(rows.length, 0);
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
      transcript: [
        { role: "caller", text: "Can I book a cleaning?" },
        { role: "agent", text: "Sure." },
      ],
    });

    const { runs } = (await bodyOf(await harness.handlers.list())) as { runs: EvalRunView[] };
    assert.deepEqual(
      runs.map((item) => item.id),
      [run.id]
    );

    const detail = await harness.handlers.detail(run.id);
    assert.equal(detail.status, 200);
    const body = (await bodyOf(detail)) as {
      results: { caseName: string; costUsd: string | null; failures: string[] }[];
    };
    assert.equal(body.results[0]?.caseName, "books a cleaning");
    assert.equal(body.results[0]?.costUsd, null);
    assert.deepEqual(body.results[0]?.failures, ["did not call check_availability"]);

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
      .set({ avgLatencyMs: 900, costUsd: "0.010000", passed: 1, status: "completed", total: 2 })
      .where(eq(evalRuns.id, base.id));
    await harness.deps.db
      .update(evalRuns)
      .set({ avgLatencyMs: 700, costUsd: null, passed: 2, status: "completed", total: 2 })
      .where(eq(evalRuns.id, head.id));
    await harness.deps.db.insert(evalResults).values([
      {
        caseName: "books a cleaning",
        latencyMs: 900,
        passed: false,
        runId: base.id,
        transcript: [],
      },
      { caseName: "shares hours", latencyMs: 900, passed: true, runId: base.id, transcript: [] },
      {
        caseName: "books a cleaning",
        latencyMs: 600,
        passed: true,
        runId: head.id,
        transcript: [],
      },
      { caseName: "shares hours", latencyMs: 800, passed: true, runId: head.id, transcript: [] },
    ]);

    const comparison = await compareEvalRuns(harness.deps, base.id, head.id);
    assert.ok(comparison);
    assert.deepEqual(
      comparison.cases.map((item) => [item.caseName, item.change, item.latencyDeltaMs]),
      [
        ["books a cleaning", "fixed", -300],
        ["shares hours", "unchanged", -100],
      ]
    );
    assert.deepEqual(comparison.totals, {
      costDeltaUsd: null,
      latencyDeltaMs: -200,
      passRateDelta: 0.5,
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
