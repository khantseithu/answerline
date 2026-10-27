import { agents, type Database, evalResults, evalRuns, tenants } from "@answerline/db";
import {
  type EvalCallerAudio,
  type EvalJob,
  type EvalRunStageLatency,
  evalExecutionInputSchema,
  evalRunCreateSchema,
} from "@answerline/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { compareEvalCases, compareEvalTotals, compareStageLatency } from "./compare";
import { EvalSuiteNotFoundError, listEvalSuites, readEvalSuite } from "./suites";
import type { EvalRunView } from "./types";

export class EvalNotFoundError extends Error {}
export class EvalBadRequestError extends Error {}
export class EvalQueueError extends Error {}

export interface EvalDeps {
  db: Database;
  enqueue: (job: EvalJob) => Promise<unknown>;
  evalsDir: string;
  tenantId: string;
}

const runIdSchema = z.uuid();
const RUN_HISTORY_LIMIT = 50;

export const evalJobId = (runId: string) => `eval_${runId}`;

const runColumns = {
  agentId: evalRuns.agentId,
  agentName: agents.name,
  avgLatencyMs: evalRuns.avgLatencyMs,
  avgWer: evalRuns.avgWer,
  costUsd: evalRuns.costUsd,
  createdAt: evalRuns.createdAt,
  error: evalRuns.error,
  executionInput: evalRuns.executionInput,
  finishedAt: evalRuns.finishedAt,
  id: evalRuns.id,
  modelOverride: evalRuns.modelOverride,
  passed: evalRuns.passed,
  pronunciationScore: evalRuns.pronunciationScore,
  stageLatency: evalRuns.stageLatency,
  startedAt: evalRuns.startedAt,
  status: evalRuns.status,
  suite: evalRuns.suite,
  total: evalRuns.total,
};

interface RunRow {
  agentId: string;
  agentName: string;
  avgLatencyMs: number | null;
  avgWer: number | null;
  costUsd: string | null;
  createdAt: Date;
  error: string | null;
  executionInput: {
    callerAudio?: EvalCallerAudio;
    liveTools?: boolean;
    mode?: "text" | "audio";
    referenceStt?: string;
    sttOverride?: string;
    ttsOverride?: string;
  } | null;
  finishedAt: Date | null;
  id: string;
  modelOverride: string | null;
  passed: number | null;
  pronunciationScore: number | null;
  stageLatency: EvalRunStageLatency | null;
  startedAt: Date | null;
  status: EvalRunView["status"];
  suite: string;
  total: number | null;
}

function runView(row: RunRow): EvalRunView {
  return {
    agentId: row.agentId,
    agentName: row.agentName,
    avgLatencyMs: row.avgLatencyMs,
    avgWer: row.avgWer,
    callerAudio: row.executionInput?.callerAudio ?? null,
    costUsd: row.costUsd,
    createdAt: row.createdAt.toISOString(),
    error: row.error,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    id: row.id,
    liveTools: row.executionInput?.liveTools ?? false,
    mode: row.executionInput?.mode ?? "text",
    modelOverride: row.modelOverride,
    passed: row.passed,
    pronunciationScore: row.pronunciationScore,
    referenceStt: row.executionInput?.referenceStt ?? null,
    stageLatency: row.stageLatency,
    startedAt: row.startedAt?.toISOString() ?? null,
    status: row.status,
    sttOverride: row.executionInput?.sttOverride ?? null,
    suite: row.suite,
    total: row.total,
    ttsOverride: row.executionInput?.ttsOverride ?? null,
  };
}

function runsQuery(deps: EvalDeps) {
  return deps.db
    .select(runColumns)
    .from(evalRuns)
    .innerJoin(
      agents,
      and(eq(evalRuns.agentId, agents.id), eq(agents.tenantId, evalRuns.tenantId))
    );
}

export async function listEvalRuns(deps: EvalDeps): Promise<EvalRunView[]> {
  const rows = await runsQuery(deps)
    .where(eq(evalRuns.tenantId, deps.tenantId))
    .orderBy(desc(evalRuns.createdAt), desc(evalRuns.id))
    .limit(RUN_HISTORY_LIMIT);
  return rows.map(runView);
}

export async function listEvalOptions(deps: EvalDeps) {
  const [agentOptions, suites] = await Promise.all([
    deps.db
      .select({ id: agents.id, name: agents.name, slug: agents.slug })
      .from(agents)
      .where(and(eq(agents.tenantId, deps.tenantId), isNull(agents.archivedAt)))
      .orderBy(asc(agents.name), asc(agents.id)),
    listEvalSuites(deps.evalsDir),
  ]);
  return { agents: agentOptions, suites };
}

async function findRun(deps: EvalDeps, id: string) {
  const [row] = await runsQuery(deps)
    .where(and(eq(evalRuns.id, id), eq(evalRuns.tenantId, deps.tenantId)))
    .limit(1);
  return row ? runView(row) : null;
}

function resultsFor(deps: EvalDeps, runIds: string[]) {
  return deps.db
    .select({
      caseName: evalResults.caseName,
      costUsd: evalResults.costUsd,
      failures: evalResults.failures,
      id: evalResults.id,
      latencyMs: evalResults.latencyMs,
      passed: evalResults.passed,
      pronunciation: evalResults.pronunciation,
      runId: evalResults.runId,
      stageLatency: evalResults.stageLatency,
      transcript: evalResults.transcript,
      wer: evalResults.wer,
    })
    .from(evalResults)
    .innerJoin(evalRuns, eq(evalResults.runId, evalRuns.id))
    .where(and(inArray(evalResults.runId, runIds), eq(evalRuns.tenantId, deps.tenantId)))
    .orderBy(asc(evalResults.caseName), asc(evalResults.id));
}

export async function getEvalRun(deps: EvalDeps, rawId: string) {
  const parsed = runIdSchema.safeParse(rawId);
  if (!parsed.success) {
    return null;
  }
  const run = await findRun(deps, parsed.data);
  if (!run) {
    return null;
  }
  const results = await resultsFor(deps, [run.id]);
  return { results: results.map(({ runId: _runId, ...result }) => result), run };
}

export type EvalRunDetail = NonNullable<Awaited<ReturnType<typeof getEvalRun>>>;

export async function compareEvalRuns(deps: EvalDeps, rawBaseId: string, rawHeadId: string) {
  const baseId = runIdSchema.safeParse(rawBaseId);
  const headId = runIdSchema.safeParse(rawHeadId);
  if (!(baseId.success && headId.success)) {
    return null;
  }
  const [base, head] = await Promise.all([findRun(deps, baseId.data), findRun(deps, headId.data)]);
  if (!(base && head)) {
    return null;
  }
  const results = await resultsFor(deps, [base.id, head.id]);
  return {
    base,
    cases: compareEvalCases(
      results.filter((result) => result.runId === base.id),
      results.filter((result) => result.runId === head.id)
    ),
    head,
    stageLatency: compareStageLatency(base.stageLatency, head.stageLatency),
    totals: compareEvalTotals(base, head),
  };
}

export type EvalRunComparison = NonNullable<Awaited<ReturnType<typeof compareEvalRuns>>>;

export async function createEvalRun(deps: EvalDeps, rawInput: unknown) {
  const input = evalRunCreateSchema.parse(rawInput);
  const [agent] = await deps.db
    .select({ agentSlug: agents.slug, config: agents.config, tenantSlug: tenants.slug })
    .from(agents)
    .innerJoin(tenants, eq(agents.tenantId, tenants.id))
    .where(
      and(
        eq(agents.id, input.agentId),
        eq(agents.tenantId, deps.tenantId),
        isNull(agents.archivedAt)
      )
    )
    .limit(1);
  if (!agent) {
    throw new EvalNotFoundError("Agent not found");
  }
  const suite = await readEvalSuite(deps.evalsDir, input.suite).catch((error: unknown) => {
    if (error instanceof EvalSuiteNotFoundError) {
      throw new EvalBadRequestError(error.message, { cause: error });
    }
    throw error;
  });
  const executionInput = evalExecutionInputSchema.parse({
    agent: agent.config,
    callerAudio: input.callerAudio,
    context: { agentSlug: agent.agentSlug, tenantSlug: agent.tenantSlug },
    judgeModel: input.judgeModel,
    liveTools: input.liveTools,
    mode: input.mode,
    modelOverride: input.modelOverride,
    referenceStt: input.referenceStt,
    sttOverride: input.sttOverride,
    suite,
    ttsOverride: input.ttsOverride,
  });
  const [run] = await deps.db
    .insert(evalRuns)
    .values({
      agentId: input.agentId,
      executionInput,
      modelOverride: input.modelOverride ?? null,
      status: "queued",
      suite: input.suite,
      tenantId: deps.tenantId,
    })
    .returning({ id: evalRuns.id });
  if (!run) {
    throw new Error("Eval run creation returned no row");
  }
  try {
    await deps.enqueue({ agentId: input.agentId, runId: run.id, tenantId: deps.tenantId });
  } catch (error) {
    await deps.db
      .update(evalRuns)
      .set({ error: "Could not queue eval run", finishedAt: new Date(), status: "failed" })
      .where(and(eq(evalRuns.id, run.id), eq(evalRuns.tenantId, deps.tenantId)));
    throw new EvalQueueError("Could not queue eval run", { cause: error });
  }
  const created = await findRun(deps, run.id);
  if (!created) {
    throw new Error("Eval run disappeared after creation");
  }
  return created;
}
