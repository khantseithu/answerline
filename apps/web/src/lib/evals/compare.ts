export interface EvalCaseOutcome {
  caseName: string;
  costUsd: string | null;
  latencyMs: number | null;
  passed: boolean;
  wer: number | null;
}

export interface EvalRunTotals {
  avgLatencyMs: number | null;
  avgWer: number | null;
  costUsd: string | null;
  passed: number | null;
  total: number | null;
}

export type EvalCaseChange = "added" | "fixed" | "regressed" | "removed" | "unchanged";

export interface EvalCaseComparison {
  base: EvalCaseOutcome | null;
  caseName: string;
  change: EvalCaseChange;
  head: EvalCaseOutcome | null;
  latencyDeltaMs: number | null;
  werDelta: number | null;
}

function caseChange(base: EvalCaseOutcome | null, head: EvalCaseOutcome | null): EvalCaseChange {
  if (!base) {
    return "added";
  }
  if (!head) {
    return "removed";
  }
  if (base.passed === head.passed) {
    return "unchanged";
  }
  return head.passed ? "fixed" : "regressed";
}

function byCaseName(results: EvalCaseOutcome[]) {
  const map = new Map<string, EvalCaseOutcome>();
  for (const result of results) {
    if (!map.has(result.caseName)) {
      map.set(result.caseName, result);
    }
  }
  return map;
}

function roundWer(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

export function compareEvalCases(
  base: EvalCaseOutcome[],
  head: EvalCaseOutcome[]
): EvalCaseComparison[] {
  const baseCases = byCaseName(base);
  const headCases = byCaseName(head);
  const names = [...new Set([...baseCases.keys(), ...headCases.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );
  return names.map((caseName) => {
    const before = baseCases.get(caseName) ?? null;
    const after = headCases.get(caseName) ?? null;
    const beforeLatency = before?.latencyMs ?? null;
    const afterLatency = after?.latencyMs ?? null;
    const beforeWer = before?.wer ?? null;
    const afterWer = after?.wer ?? null;
    return {
      base: before,
      caseName,
      change: caseChange(before, after),
      head: after,
      latencyDeltaMs:
        beforeLatency === null || afterLatency === null ? null : afterLatency - beforeLatency,
      werDelta: beforeWer === null || afterWer === null ? null : roundWer(afterWer - beforeWer),
    };
  });
}

export function passRate(totals: EvalRunTotals) {
  if (totals.passed === null || !totals.total) {
    return null;
  }
  return totals.passed / totals.total;
}

export function compareEvalTotals(base: EvalRunTotals, head: EvalRunTotals) {
  const baseRate = passRate(base);
  const headRate = passRate(head);
  return {
    costDeltaUsd:
      base.costUsd === null || head.costUsd === null
        ? null
        : Math.round((Number(head.costUsd) - Number(base.costUsd)) * 1_000_000) / 1_000_000,
    latencyDeltaMs:
      base.avgLatencyMs === null || head.avgLatencyMs === null
        ? null
        : head.avgLatencyMs - base.avgLatencyMs,
    passRateDelta: baseRate === null || headRate === null ? null : headRate - baseRate,
    werDelta:
      base.avgWer === null || head.avgWer === null ? null : roundWer(head.avgWer - base.avgWer),
  };
}
