import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, createDb, evalResults, evalRuns, tenants } from "@answerline/db";
import {
  type EvalExecutionOutput,
  evalExecutionInputSchema,
  evalJobSchema,
  parseAgentConfig,
  QUEUES,
} from "@answerline/shared";
import { Queue, Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { seedCallAgent } from "./call-event-test-fixtures.ts";
import {
  createEvalProcessor,
  findTenantAgent,
  normalizeEvalOutput,
  processEvalRun,
} from "./evals.ts";

const skip =
  process.env.DATABASE_URL && process.env.REDIS_URL ? false : "DATABASE_URL or REDIS_URL not set";
const suiteMismatchPattern = /did not match the requested suite/;
const providerErrorPattern = /sensitive provider detail/;
const contextMismatchPattern = /eval execution context does not match/;

const input = evalExecutionInputSchema.parse({
  agent: {
    greeting: "Hello",
    instructions: "Be a concise receptionist.",
    models: {
      llm: { primary: "openai/gpt-4.1-mini" },
      stt: "deepgram/nova-3",
      tts: "cartesia/sonic-3",
    },
    name: "Test Clinic",
  },
  suite: [{ caller: "Hi", expect: {}, name: "greeting" }],
});

const output = {
  aggregate: { avgLatencyMs: 12, costUsd: null, passed: 1, total: 1 },
  results: [
    {
      caseName: "greeting",
      costUsd: null,
      failures: [],
      latencyMs: 12,
      modelUsage: [
        {
          model: "gpt-4.1-mini",
          provider: "openai",
          quantity: 1000,
          stage: "llm",
          unit: "input_tokens",
        },
      ],
      passed: true,
      transcript: [
        { role: "caller" as const, text: "Hi" },
        { role: "agent" as const, text: "Hello" },
      ],
    },
  ],
} satisfies EvalExecutionOutput;

test("normalizes case and aggregate costs from actual model usage", () => {
  const normalized = normalizeEvalOutput(input, output);
  assert.equal(normalized.results[0]?.costUsd, 0.0004);
  assert.equal(normalized.aggregate.costUsd, 0.0004);
  assert.equal(normalized.aggregate.avgLatencyMs, 12);
});

test("keeps cost unknown when a case has no model usage", () => {
  const normalized = normalizeEvalOutput(input, {
    ...output,
    results: [{ ...output.results[0], modelUsage: undefined }],
  });
  assert.equal(normalized.results[0]?.costUsd, null);
  assert.equal(normalized.aggregate.costUsd, null);
});

test("rejects output whose cases do not match the requested suite", () => {
  assert.throws(
    () =>
      normalizeEvalOutput(input, {
        ...output,
        results: [{ ...output.results[0], caseName: "unexpected" }],
      }),
    suiteMismatchPattern
  );
});

test("persists eval runs, retries safely, and executes queue jobs", {
  skip,
  timeout: 30_000,
}, async () => {
  const db = createDb();
  const tenantSlug = `eval-${crypto.randomUUID()}`;
  const prefix = `eval-test-${crypto.randomUUID()}`;
  const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue(QUEUES.evals, { connection, prefix });
  let worker: Worker | undefined;
  let runId: string | undefined;
  try {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Eval test", slug: tenantSlug })
      .returning();
    assert.ok(tenant);
    const config = parseAgentConfig(
      await readFile(new URL("../../../agents/bright-smile-dental.yaml", import.meta.url), "utf8")
    );
    const [agent] = await db
      .insert(agents)
      .values({ config, name: config.name, slug: "bright-smile-dental", tenantId: tenant.id })
      .returning();
    assert.ok(agent);
    const [run] = await db
      .insert(evalRuns)
      .values({
        agentId: agent.id,
        executionInput: input,
        suite: "bright-smile-dental",
        tenantId: tenant.id,
      })
      .returning();
    assert.ok(run);
    runId = run.id;
    let calls = 0;
    const identifiers = { agentId: agent.id, runId: run.id, tenantId: tenant.id };
    const options = {
      execute: () => {
        calls += 1;
        return Promise.resolve(output);
      },
    };
    await processEvalRun(db, identifiers, options);
    await processEvalRun(db, identifiers, options);

    const [savedRun] = await db.select().from(evalRuns).where(eq(evalRuns.id, run.id));
    const savedResults = await db.select().from(evalResults).where(eq(evalResults.runId, run.id));
    assert.equal(calls, 1);
    assert.equal(savedRun?.status, "completed");
    assert.equal(savedRun?.costUsd, "0.000400");
    assert.equal(savedResults.length, 1);
    assert.equal(savedResults[0]?.costUsd, "0.000400");

    const [failedRun] = await db
      .insert(evalRuns)
      .values({
        agentId: agent.id,
        executionInput: input,
        suite: "bright-smile-dental",
        tenantId: tenant.id,
      })
      .returning();
    assert.ok(failedRun);
    await assert.rejects(
      processEvalRun(
        db,
        { agentId: agent.id, runId: failedRun.id, tenantId: tenant.id },
        { execute: () => Promise.reject(new Error("sensitive provider detail")) }
      ),
      providerErrorPattern
    );
    const [savedFailedRun] = await db.select().from(evalRuns).where(eq(evalRuns.id, failedRun.id));
    assert.equal(savedFailedRun?.status, "failed");
    assert.equal(savedFailedRun?.error, "Eval execution failed");

    const [wrongTenantRun] = await db
      .insert(evalRuns)
      .values({
        agentId: agent.id,
        executionInput: input,
        suite: "bright-smile-dental",
        tenantId: tenant.id,
      })
      .returning();
    assert.ok(wrongTenantRun);
    let wrongTenantCalls = 0;
    await assert.rejects(
      processEvalRun(
        db,
        { agentId: agent.id, runId: wrongTenantRun.id, tenantId: crypto.randomUUID() },
        {
          execute: () => {
            wrongTenantCalls += 1;
            return Promise.resolve(output);
          },
        }
      )
    );
    const [savedWrongTenantRun] = await db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.id, wrongTenantRun.id));
    assert.equal(wrongTenantCalls, 0);
    assert.equal(savedWrongTenantRun?.status, "queued");
    assert.equal(savedWrongTenantRun?.error, null);

    const contextMismatchInput = evalExecutionInputSchema.parse({
      ...input,
      context: { agentSlug: "stale-agent", tenantSlug },
      liveTools: true,
    });
    const [contextMismatchRun] = await db
      .insert(evalRuns)
      .values({
        agentId: agent.id,
        executionInput: contextMismatchInput,
        suite: "bright-smile-dental",
        tenantId: tenant.id,
      })
      .returning();
    assert.ok(contextMismatchRun);
    let contextMismatchCalls = 0;
    await assert.rejects(
      processEvalRun(
        db,
        { agentId: agent.id, runId: contextMismatchRun.id, tenantId: tenant.id },
        {
          execute: () => {
            contextMismatchCalls += 1;
            return Promise.resolve(output);
          },
        }
      ),
      contextMismatchPattern
    );
    const [savedContextMismatchRun] = await db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.id, contextMismatchRun.id));
    assert.equal(contextMismatchCalls, 0);
    assert.equal(savedContextMismatchRun?.status, "failed");
    assert.equal(savedContextMismatchRun?.error, "Eval execution failed");

    const [missingSnapshotRun] = await db
      .insert(evalRuns)
      .values({
        agentId: agent.id,
        executionInput: null,
        suite: "bright-smile-dental",
        tenantId: tenant.id,
      })
      .returning();
    assert.ok(missingSnapshotRun);
    await assert.rejects(
      processEvalRun(db, {
        agentId: agent.id,
        runId: missingSnapshotRun.id,
        tenantId: tenant.id,
      })
    );
    const [savedMissingSnapshotRun] = await db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.id, missingSnapshotRun.id));
    assert.equal(savedMissingSnapshotRun?.status, "failed");
    assert.equal(savedMissingSnapshotRun?.error, "Eval execution failed");

    const [invalidSnapshotRun] = await db
      .insert(evalRuns)
      .values({
        agentId: agent.id,
        executionInput: input,
        suite: "bright-smile-dental",
        tenantId: tenant.id,
      })
      .returning();
    assert.ok(invalidSnapshotRun);
    await db.execute(
      sql`update eval_runs set execution_input = '{}'::jsonb where id = ${invalidSnapshotRun.id}`
    );
    await assert.rejects(
      processEvalRun(db, {
        agentId: agent.id,
        runId: invalidSnapshotRun.id,
        tenantId: tenant.id,
      })
    );
    const [savedInvalidSnapshotRun] = await db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.id, invalidSnapshotRun.id));
    assert.equal(savedInvalidSnapshotRun?.status, "failed");
    assert.equal(savedInvalidSnapshotRun?.error, "Eval execution failed");

    const [queuedRun] = await db
      .insert(evalRuns)
      .values({
        agentId: agent.id,
        executionInput: input,
        suite: "bright-smile-dental",
        tenantId: tenant.id,
      })
      .returning();
    assert.ok(queuedRun);
    const job = evalJobSchema.parse({
      agentId: agent.id,
      runId: queuedRun.id,
      tenantId: tenant.id,
    });
    const done = new Promise<void>((resolve, reject) => {
      worker = new Worker(
        QUEUES.evals,
        createEvalProcessor(db, { execute: () => Promise.resolve(output) }),
        { connection, prefix }
      );
      worker.on("error", reject);
      worker.on("failed", (_job, error) => reject(error));
      worker.on("completed", () => resolve());
    });
    await queue.add("run-eval", job, { jobId: `eval_${queuedRun.id}` });
    await done;
    const [savedQueuedRun] = await db.select().from(evalRuns).where(eq(evalRuns.id, queuedRun.id));
    assert.equal(savedQueuedRun?.status, "completed");
    assert.equal(savedQueuedRun?.passed, 1);
  } finally {
    await worker?.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
    if (runId) {
      await db.delete(evalRuns).where(eq(evalRuns.id, runId));
    }
    await db.delete(tenants).where(eq(tenants.slug, tenantSlug));
    await db.$client.end();
  }
});

test("eval agent lookup uses the selected workspace for identical slugs", { skip }, async () => {
  const db = createDb();
  const first = `eval-${crypto.randomUUID()}`;
  const second = `eval-${crypto.randomUUID()}`;
  try {
    await seedCallAgent(db, first);
    await seedCallAgent(db, second);
    const one = await findTenantAgent(db, "bright-smile-dental", first);
    const two = await findTenantAgent(db, "bright-smile-dental", second);
    assert.ok(one && two);
    assert.equal(one.tenantSlug, first);
    assert.equal(two.tenantSlug, second);
    assert.notEqual(one.agentId, two.agentId);
    assert.equal(await findTenantAgent(db, "bright-smile-dental", "unknown-workspace"), undefined);
  } finally {
    await db.delete(tenants).where(eq(tenants.slug, first));
    await db.delete(tenants).where(eq(tenants.slug, second));
    await db.$client.end();
  }
});
