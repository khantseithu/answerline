import { bookings, calls, type Database } from "@answerline/db";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";

export function getUtcDayRange(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { end, start };
}

export async function getOverviewData(db: Database, tenantId: string, now = new Date()) {
  const { end, start } = getUtcDayRange(now);
  const [[summary], [bookingSummary], recentCalls] = await Promise.all([
    db
      .select({
        averageDurationMs: sql<
          number | null
        >`(avg(case when ${calls.endedAt} is not null then ${calls.durationMs} end))::float8`,
        callsToday: count(),
        completedOrFailedCalls: count(
          sql`case when ${calls.status} in ('completed', 'failed') then 1 end`
        ),
        failedCalls: count(sql`case when ${calls.status} = 'failed' then 1 end`),
        knownCostUsd: sql<string | null>`sum(${calls.costUsd})`,
        unpricedCalls: count(sql`case when ${calls.costUsd} is null then 1 end`),
      })
      .from(calls)
      .where(
        and(eq(calls.tenantId, tenantId), gte(calls.startedAt, start), lt(calls.startedAt, end))
      ),
    db
      .select({ count: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.status, "confirmed"),
          gte(bookings.createdAt, start),
          lt(bookings.createdAt, end)
        )
      ),
    db
      .select({
        channel: calls.channel,
        costUsd: calls.costUsd,
        durationMs: calls.durationMs,
        fromNumber: calls.fromNumber,
        id: calls.id,
        startedAt: calls.startedAt,
        status: calls.status,
      })
      .from(calls)
      .where(eq(calls.tenantId, tenantId))
      .orderBy(desc(calls.startedAt))
      .limit(5),
  ]);
  if (!(summary && bookingSummary)) {
    throw new Error("Could not load overview data");
  }

  return {
    averageDurationMs: summary.averageDurationMs,
    bookingsToday: bookingSummary.count,
    callsToday: summary.callsToday,
    completedOrFailedCalls: summary.completedOrFailedCalls,
    failedCalls: summary.failedCalls,
    failureRate:
      summary.completedOrFailedCalls === 0
        ? null
        : summary.failedCalls / summary.completedOrFailedCalls,
    knownCostUsd: summary.knownCostUsd,
    recentCalls,
    unpricedCalls: summary.unpricedCalls,
  };
}
