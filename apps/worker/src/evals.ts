import { agents, type Database, evalResults, evalRuns, tenants } from "@answerline/db";
import {
  type EvalExecutionInput,
  type EvalExecutionOutput,
  type EvalJob,
  evalExecutionInputSchema,
  evalExecutionOutputSchema,
  evalJobSchema,
} from "@answerline/shared";
import type { Job } from "bullmq";
import { and, eq, ne } from "drizzle-orm";
import { calculateCallCost, parseCostPrices } from "./costs.ts";
import { executeEval } from "./eval-execution.ts";

export interface EvalProcessorOptions {
  execute?: (input: EvalExecutionInput) => Promise<EvalExecutionOutput>;
}

export function normalizeEvalOutput(
  input: EvalExecutionInput,
  rawOutput: unknown
): EvalExecutionOutput {
  const output = evalExecutionOutputSchema.parse(rawOutput);
  const expectedNames = input.suite.map((item) => item.name);
  const resultNames = output.results.map((item) => item.caseName);
  if (
    resultNames.length !== expectedNames.length ||
    resultNames.some((name, i) => name !== expectedNames[i])
  ) {
    throw new Error("eval runner results did not match the requested suite");
  }

  const prices = parseCostPrices(process.env.COST_PRICES_JSON);
  const results = output.results.map((result) => ({
    ...result,
    costUsd: calculateCallCost(result.modelUsage, prices).costUsd,
  }));
  const latencies = results.flatMap((result) =>
    result.latencyMs === null ? [] : [result.latencyMs]
  );
  const costs = results.flatMap((result) => (result.costUsd === null ? [] : [result.costUsd]));
  return {
    aggregate: {
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)
        : null,
      costUsd:
        costs.length === results.length
          ? Math.round(costs.reduce((sum, cost) => sum + cost, 0) * 1_000_000) / 1_000_000
          : null,
      passed: results.filter((result) => result.passed).length,
      total: results.length,
    },
    results,
  };
}

function startEvalRun(db: Database, job: EvalJob) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(evalRuns)
      .where(
        and(
          eq(evalRuns.id, job.runId),
          eq(evalRuns.agentId, job.agentId),
          eq(evalRuns.tenantId, job.tenantId)
        )
      )
      .for("update");
    if (!run) {
      throw new Error("eval run was not found for tenant");
    }
    if (run.status === "completed") {
      return null;
    }
    if (!run.executionInput) {
      throw new Error("eval run has no execution input");
    }

    const input = evalExecutionInputSchema.parse(run.executionInput);
    const [identity] = await tx
      .select({ agentSlug: agents.slug, tenantSlug: tenants.slug })
      .from(agents)
      .innerJoin(tenants, eq(agents.tenantId, tenants.id))
      .where(and(eq(agents.id, job.agentId), eq(agents.tenantId, job.tenantId)));
    if (
      !identity ||
      (input.liveTools && !input.context) ||
      (input.context &&
        (input.context.agentSlug !== identity.agentSlug ||
          input.context.tenantSlug !== identity.tenantSlug))
    ) {
      throw new Error("eval execution context does not match the persisted agent and tenant");
    }
    await tx
      .update(evalRuns)
      .set({ error: null, finishedAt: null, startedAt: new Date(), status: "running" })
      .where(eq(evalRuns.id, job.runId));
    return input;
  });
}

async function failEvalRun(db: Database, job: EvalJob) {
  await db
    .update(evalRuns)
    .set({ error: "Eval execution failed", finishedAt: new Date(), status: "failed" })
    .where(
      and(
        eq(evalRuns.id, job.runId),
        eq(evalRuns.agentId, job.agentId),
        eq(evalRuns.tenantId, job.tenantId),
        ne(evalRuns.status, "completed")
      )
    );
}

async function saveEvalOutput(db: Database, job: EvalJob, output: EvalExecutionOutput) {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: evalRuns.id, status: evalRuns.status })
      .from(evalRuns)
      .where(
        and(
          eq(evalRuns.id, job.runId),
          eq(evalRuns.agentId, job.agentId),
          eq(evalRuns.tenantId, job.tenantId)
        )
      )
      .for("update");
    if (!run) {
      throw new Error("eval run was not found for tenant");
    }
    if (run.status === "completed") {
      return;
    }

    await tx.delete(evalResults).where(eq(evalResults.runId, job.runId));
    if (output.results.length) {
      await tx.insert(evalResults).values(
        output.results.map((result) => ({
          caseName: result.caseName,
          costUsd: result.costUsd?.toFixed(6) ?? null,
          failures: result.failures,
          latencyMs: result.latencyMs,
          passed: result.passed,
          runId: job.runId,
          transcript: result.transcript,
        }))
      );
    }
    await tx
      .update(evalRuns)
      .set({
        avgLatencyMs: output.aggregate.avgLatencyMs,
        costUsd: output.aggregate.costUsd?.toFixed(6) ?? null,
        error: null,
        finishedAt: new Date(),
        passed: output.aggregate.passed,
        status: "completed",
        total: output.aggregate.total,
      })
      .where(eq(evalRuns.id, job.runId));
  });
}

export async function processEvalRun(
  db: Database,
  rawJob: unknown,
  options: EvalProcessorOptions = {}
) {
  const job = evalJobSchema.parse(rawJob);
  try {
    const input = await startEvalRun(db, job);
    if (!input) {
      return;
    }
    const rawOutput = await (options.execute ?? executeEval)(input);
    const output = normalizeEvalOutput(input, rawOutput);
    await saveEvalOutput(db, job, output);
  } catch (error) {
    await failEvalRun(db, job);
    throw error;
  }
}

export function createEvalProcessor(db: Database, options: EvalProcessorOptions = {}) {
  return async (job: Job) => processEvalRun(db, job.data, options);
}

export async function findDefaultTenantAgent(db: Database, slug: string) {
  const [agent] = await db
    .select({
      agentId: agents.id,
      agentSlug: agents.slug,
      tenantId: agents.tenantId,
      tenantSlug: tenants.slug,
    })
    .from(agents)
    .innerJoin(tenants, eq(agents.tenantId, tenants.id))
    .where(and(eq(agents.slug, slug), eq(tenants.slug, "default")));
  return agent;
}

export async function createEvalRun(
  db: Database,
  input: { agentId: string; tenantId: string; suite: string; executionInput: EvalExecutionInput }
) {
  const [run] = await db
    .insert(evalRuns)
    .values({
      agentId: input.agentId,
      executionInput: input.executionInput,
      modelOverride: input.executionInput.modelOverride ?? null,
      status: "queued",
      suite: input.suite,
      tenantId: input.tenantId,
    })
    .returning({ id: evalRuns.id });
  if (!run) {
    throw new Error("failed to create eval run");
  }
  return run.id;
}
