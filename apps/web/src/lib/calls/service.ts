import { agents, calls, callTurns, type Database } from "@answerline/db";
import type { CallsListQuery } from "@answerline/shared";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

function callFilters(tenantId: string, query: CallsListQuery) {
  const filters = [eq(calls.tenantId, tenantId)];
  if (query.agentId) {
    filters.push(eq(calls.agentId, query.agentId));
  }
  if (query.channel) {
    filters.push(eq(calls.channel, query.channel));
  }
  if (query.outcome) {
    filters.push(eq(calls.outcome, query.outcome));
  }
  if (query.from) {
    filters.push(gte(calls.startedAt, new Date(`${query.from}T00:00:00.000Z`)));
  }
  if (query.to) {
    const nextDay = new Date(`${query.to}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    filters.push(lt(calls.startedAt, nextDay));
  }
  if (query.q) {
    filters.push(
      sql`exists (select 1 from ${callTurns} where ${callTurns.callId} = ${calls.id} and position(lower(${query.q}) in lower(${callTurns.text})) > 0)`
    );
  }
  return and(...filters);
}

export async function listCalls(db: Database, tenantId: string, query: CallsListQuery) {
  const where = callFilters(tenantId, query);
  const offset = (query.page - 1) * query.pageSize;
  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        agentName: agents.name,
        caller: calls.fromNumber,
        channel: calls.channel,
        costUsd: calls.costUsd,
        durationMs: calls.durationMs,
        id: calls.id,
        outcome: calls.outcome,
        startedAt: calls.startedAt,
        status: calls.status,
      })
      .from(calls)
      .innerJoin(agents, eq(calls.agentId, agents.id))
      .where(where)
      .orderBy(desc(calls.startedAt), desc(calls.id))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(calls).where(where),
  ]);
  return { items, page: query.page, pageSize: query.pageSize, total };
}

export async function listCallFilters(db: Database, tenantId: string) {
  const [agentOptions, outcomeRows] = await Promise.all([
    db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), isNull(agents.archivedAt)))
      .orderBy(asc(agents.name), asc(agents.id)),
    db
      .selectDistinct({ outcome: calls.outcome })
      .from(calls)
      .where(and(eq(calls.tenantId, tenantId), sql`${calls.outcome} is not null`))
      .orderBy(asc(calls.outcome)),
  ]);
  return {
    agents: agentOptions,
    outcomes: outcomeRows.flatMap(({ outcome }) => (outcome ? [outcome] : [])),
  };
}
