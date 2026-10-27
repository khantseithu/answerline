import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  agents,
  createDb,
  evalResults,
  evalRuns,
  tenants,
  webhookDeliveries,
  webhookEndpoints,
} from "@answerline/db";
import {
  type EvalExecutionOutput,
  evalExecutionInputSchema,
  evalJobSchema,
  parseAgentConfig,
  QUEUES,
  type WebhookDeliveryJob,
} from "@answerline/shared";
import { type Queue as BullQueue, Queue, Worker } from "bullmq";
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
  aggregate: { avgLatencyMs: 12, avgWer: null, costUsd: null, passed: 1, total: 1 },
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
      stageLatency: { llmTotalMs: [800, 1200], llmTtftMs: [300, 500] },
      transcript: [
        { role: "caller" as const, text: "Hi" },
        { role: "agent" as const, text: "Hello" },
      ],
      wer: null,
    },
  ],
} satisfies EvalExecutionOutput;

const [greetingResult] = output.results;
assert.ok(greetingResult);

test("normalizes case and aggregate costs from actual model usage", () => {
  const normalized = normalizeEvalOutput(input, output);
  assert.equal(normalized.results[0]?.costUsd, 0.0004);
  assert.equal(normalized.aggregate.costUsd, 0.0004);
  assert.equal(normalized.aggregate.avgLatencyMs, 12);
  assert.equal(normalized.aggregate.avgWer, null);
});

test("averages WER over cases that have one", () => {
  const second = { ...greetingResult, caseName: "second", wer: 0.5 };
  const third = { ...greetingResult, caseName: "third", wer: null };
  const suiteInput = {
    ...input,
    suite: [
      ...input.suite,
      { caller: "Hi", expect: {}, name: "second" },
      { caller: "Hi", expect: {}, name: "third" },
    ],
  };
  const normalized = normalizeEvalOutput(suiteInput, {
    ...output,
    results: [{ ...greetingResult, wer: 0.25 }, second, third],
  });
  assert.equal(normalized.aggregate.avgWer, 0.375);
  assert.deepEqual(
    normalized.results.map((result) => result.wer),
    [0.25, 0.5, null]
  );
});

test("scores pronunciation as matched over checked entities across cases", () => {
  const suiteInput = {
    ...input,
    suite: [
      ...input.suite,
      { caller: "Hi", expect: {}, name: "second" },
      { caller: "Hi", expect: {}, name: "third" },
    ],
  };
  const normalized = normalizeEvalOutput(suiteInput, {
    ...output,
    results: [
      { ...greetingResult, pronunciation: { checked: 4, matched: 3, missed: ["Nguyen"] } },
      {
        ...greetingResult,
        caseName: "second",
        pronunciation: { checked: 2, matched: 0, missed: [] },
      },
      { ...greetingResult, caseName: "third", pronunciation: null },
    ],
  });
  assert.equal(normalized.aggregate.pronunciationScore, 0.5);
  assert.equal(normalizeEvalOutput(input, output).aggregate.pronunciationScore, null);
});

test("summarizes per-stage latency percentiles across all cases", () => {
  const multiInput = evalExecutionInputSchema.parse({
    ...input,
    suite: [
      { caller: "Hi", expect: {}, name: "greeting" },
      { caller: "Bye", expect: {}, name: "farewell" },
    ],
  });
  const [first] = output.results;
  const normalized = normalizeEvalOutput(multiInput, {
    ...output,
    results: [
      first,
      {
        ...first,
        caseName: "farewell",
        stageLatency: { llmTtftMs: [100], sttMs: [150] },
      },
    ],
  });
  assert.deepEqual(normalized.aggregate.stageLatency, {
    llmTotalMs: { p50: 800, p95: 1200 },
    llmTtftMs: { p50: 300, p95: 500 },
    sttMs: { p50: 150, p95: 150 },
  });
});

test("reports null aggregate stage latency when no case has samples", () => {
  const normalized = normalizeEvalOutput(input, {
    ...output,
    results: [{ ...output.results[0], stageLatency: undefined }],
  });
  assert.equal(normalized.aggregate.stageLatency, null);
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
        return Promise.resolve({
          ...output,
          results: [
            {
              ...greetingResult,
              pronunciation: { checked: 4, matched: 3, missed: ["Nguyen"] },
              wer: 0.25,
            },
          ],
        });
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
    assert.equal(savedRun?.avgWer, 0.25);
    assert.equal(savedResults[0]?.wer, 0.25);
    assert.equal(savedRun?.pronunciationScore, 0.75);
    assert.deepEqual(savedResults[0]?.pronunciation, {
      checked: 4,
      matched: 3,
      missed: ["Nguyen"],
    });
    assert.deepEqual(savedResults[0]?.stageLatency, {
      llmTotalMs: [800, 1200],
      llmTtftMs: [300, 500],
    });
    assert.deepEqual(savedRun?.stageLatency, {
      llmTotalMs: { p50: 800, p95: 1200 },
      llmTtftMs: { p50: 300, p95: 500 },
    });

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
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        encryptedSecret: "encrypted",
        events: ["eval.completed"],
        name: "Eval dashboard",
        tenantId: tenant.id,
        url: "https://hooks.example.test/evals",
      })
      .returning();
    assert.ok(endpoint);
    const queuedWebhooks: Array<{ data: WebhookDeliveryJob; jobId: unknown }> = [];
    const webhookQueue = {
      add: (_name: string, data: WebhookDeliveryJob, queueOptions: { jobId?: unknown }) => {
        queuedWebhooks.push({ data, jobId: queueOptions.jobId });
        return Promise.resolve({});
      },
    } as unknown as BullQueue<WebhookDeliveryJob>;
    const job = evalJobSchema.parse({
      agentId: agent.id,
      runId: queuedRun.id,
      tenantId: tenant.id,
    });
    const done = new Promise<void>((resolve, reject) => {
      worker = new Worker(
        QUEUES.evals,
        createEvalProcessor(db, { execute: () => Promise.resolve(output), webhookQueue }),
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
    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpoint.id));
    assert.ok(delivery);
    assert.equal(delivery.eventType, "eval.completed");
    assert.equal(delivery.eventId, `eval_${queuedRun.id}_completed`);
    assert.equal(delivery.payload.created_at, savedQueuedRun.finishedAt?.toISOString());
    if (delivery.payload.type !== "eval.completed") {
      throw new Error("Expected eval.completed webhook payload");
    }
    assert.equal(delivery.payload.data.agent_id, agent.id);
    assert.equal(delivery.payload.data.eval_run_id, queuedRun.id);
    assert.equal(delivery.payload.data.status, "completed");
    assert.equal(delivery.payload.data.suite, "bright-smile-dental");
    assert.equal(delivery.payload.data.passed, 1);
    assert.equal(delivery.payload.data.total, 1);
    await processEvalRun(db, job, { webhookQueue });
    assert.equal(queuedWebhooks.length, 2);
    assert.equal(queuedWebhooks[0]?.jobId, queuedWebhooks[1]?.jobId);
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
