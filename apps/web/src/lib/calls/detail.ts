import { agents, calls, callTurns, type Database, toolCalls } from "@answerline/db";
import { type CostLine, callIdSchema } from "@answerline/shared";
import { and, asc, eq, sql } from "drizzle-orm";

export async function getCallDetail(db: Database, tenantId: string, rawId: string) {
  const parsed = callIdSchema.safeParse(rawId);
  if (!parsed.success) {
    return null;
  }
  const id = parsed.data;
  const [call] = await db
    .select({
      agentName: agents.name,
      channel: calls.channel,
      costBreakdown: calls.costBreakdown,
      costUsd: calls.costUsd,
      direction: calls.direction,
      durationMs: calls.durationMs,
      endedAt: calls.endedAt,
      fromNumber: calls.fromNumber,
      hasRecording: sql<boolean>`${calls.recordingUrl} is not null`,
      id: calls.id,
      outcome: calls.outcome,
      recordingStartedAt: calls.recordingStartedAt,
      sentiment: calls.sentiment,
      startedAt: calls.startedAt,
      status: calls.status,
      summary: calls.summary,
      toNumber: calls.toNumber,
    })
    .from(calls)
    .innerJoin(agents, eq(calls.agentId, agents.id))
    .where(and(eq(calls.id, id), eq(calls.tenantId, tenantId)))
    .limit(1);
  if (!call) {
    return null;
  }

  const [turns, tools] = await Promise.all([
    db
      .select({
        endedAt: callTurns.endedAt,
        id: callTurns.id,
        interrupted: callTurns.interrupted,
        latency: callTurns.latency,
        role: callTurns.role,
        seq: callTurns.seq,
        startedAt: callTurns.startedAt,
        text: callTurns.text,
      })
      .from(callTurns)
      .innerJoin(calls, eq(callTurns.callId, calls.id))
      .where(and(eq(calls.id, id), eq(calls.tenantId, tenantId)))
      .orderBy(asc(callTurns.seq)),
    db
      .select({
        args: toolCalls.args,
        createdAt: toolCalls.createdAt,
        error: toolCalls.error,
        id: toolCalls.id,
        latencyMs: toolCalls.latencyMs,
        name: toolCalls.name,
        result: toolCalls.result,
        seq: toolCalls.seq,
        status: toolCalls.status,
      })
      .from(toolCalls)
      .innerJoin(calls, eq(toolCalls.callId, calls.id))
      .where(and(eq(calls.id, id), eq(calls.tenantId, tenantId)))
      .orderBy(asc(toolCalls.seq)),
  ]);

  return {
    ...call,
    costBreakdown: (call.costBreakdown ?? null) as CostLine[] | null,
    toolCalls: tools,
    turns,
  };
}

export type CallDetail = NonNullable<Awaited<ReturnType<typeof getCallDetail>>>;
