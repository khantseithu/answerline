import { calls, type Database, evalRuns, tenants } from "@answerline/db";
import { and, eq, gt, gte, lt, sql } from "drizzle-orm";

export class WorkspaceUsageLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function getWorkspaceUsage(db: Database, tenantId: string, now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const nowIso = now.toISOString();
  const periodStartIso = periodStart.toISOString();
  const periodEndIso = periodEnd.toISOString();
  const [[usage], [evalUsage], [workspace]] = await Promise.all([
    db
      .select({
        callSeconds: sql<string>`coalesce(sum(extract(epoch from (least(coalesce(${calls.endedAt}, ${nowIso}::timestamptz), ${periodEndIso}::timestamptz) - greatest(${calls.startedAt}, ${periodStartIso}::timestamptz)))), 0)::text`,
        providerSpendUsd: sql<string>`coalesce(sum(case when ${calls.startedAt} >= ${periodStartIso}::timestamptz and ${calls.startedAt} < ${periodEndIso}::timestamptz then ${calls.costUsd} else 0 end), 0)::text`,
      })
      .from(calls)
      .where(
        and(
          eq(calls.tenantId, tenantId),
          lt(calls.startedAt, periodEnd),
          gt(sql`coalesce(${calls.endedAt}, ${nowIso}::timestamptz)`, periodStartIso)
        )
      ),
    db
      .select({
        providerSpendUsd: sql<string>`coalesce(sum(${evalRuns.costUsd}), 0)::text`,
      })
      .from(evalRuns)
      .where(
        and(
          eq(evalRuns.tenantId, tenantId),
          gte(evalRuns.createdAt, periodStart),
          lt(evalRuns.createdAt, periodEnd)
        )
      ),
    db
      .select({
        monthlyCallMinutesLimit: tenants.monthlyCallMinutesLimit,
        monthlyProviderSpendLimitUsd: tenants.monthlyProviderSpendLimitUsd,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1),
  ]);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  return {
    callMinutesUsed: Number(usage?.callSeconds ?? 0) / 60,
    monthlyCallMinutesLimit: workspace.monthlyCallMinutesLimit,
    monthlyProviderSpendLimitUsd: workspace.monthlyProviderSpendLimitUsd,
    periodEnd: periodEnd.toISOString(),
    periodStart: periodStart.toISOString(),
    providerSpendUsdUsed:
      Number(usage?.providerSpendUsd ?? 0) + Number(evalUsage?.providerSpendUsd ?? 0),
  };
}

export async function assertWorkspaceUsageAvailable(
  db: Database,
  tenantId: string,
  now = new Date()
) {
  const usage = await getWorkspaceUsage(db, tenantId, now);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((Date.parse(usage.periodEnd) - now.getTime()) / 1000)
  );
  if (
    usage.monthlyCallMinutesLimit !== null &&
    usage.callMinutesUsed >= usage.monthlyCallMinutesLimit
  ) {
    throw new WorkspaceUsageLimitError(
      "Workspace monthly call-minute limit reached",
      retryAfterSeconds
    );
  }
  if (
    usage.monthlyProviderSpendLimitUsd !== null &&
    usage.providerSpendUsdUsed >= Number(usage.monthlyProviderSpendLimitUsd)
  ) {
    throw new WorkspaceUsageLimitError(
      "Workspace monthly provider-spend limit reached",
      retryAfterSeconds
    );
  }
}
