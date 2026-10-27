import type { EvalRunStageLatency, EvalStageLatency } from "./eval-suite.ts";

export const EVAL_LATENCY_STAGES = ["sttMs", "llmTtftMs", "llmTotalMs", "ttsTtfbMs"] as const;

export const EVAL_LATENCY_STAGE_LABELS = {
  llmTotalMs: "LLM total",
  llmTtftMs: "LLM TTFT",
  sttMs: "STT",
  ttsTtfbMs: "TTS TTFB",
} as const satisfies Record<(typeof EVAL_LATENCY_STAGES)[number], string>;

export function nearestRankPercentile(samples: readonly number[], percentile: number) {
  if (samples.length === 0) {
    return null;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(Math.max(Math.ceil((percentile / 100) * sorted.length), 1), sorted.length);
  return sorted[rank - 1] ?? null;
}

export function summarizeStageLatency(
  cases: readonly (EvalStageLatency | null | undefined)[]
): EvalRunStageLatency | null {
  const summary: EvalRunStageLatency = {};
  for (const stage of EVAL_LATENCY_STAGES) {
    const samples = cases.flatMap((item) => item?.[stage] ?? []);
    const p50 = nearestRankPercentile(samples, 50);
    const p95 = nearestRankPercentile(samples, 95);
    if (p50 !== null && p95 !== null) {
      summary[stage] = { p50, p95 };
    }
  }
  return Object.keys(summary).length ? summary : null;
}

export function formatStageLatency(summary: EvalRunStageLatency | null | undefined) {
  if (!summary) {
    return null;
  }
  const parts = EVAL_LATENCY_STAGES.flatMap((stage) => {
    const percentiles = summary[stage];
    return percentiles
      ? [`${EVAL_LATENCY_STAGE_LABELS[stage]} ${percentiles.p50}/${percentiles.p95} ms`]
      : [];
  });
  return parts.length ? `${parts.join(" · ")} (p50/p95)` : null;
}
