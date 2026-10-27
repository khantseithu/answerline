import { EVAL_LATENCY_STAGE_LABELS } from "@answerline/shared";
import { AlertCircleIcon, ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EvalCaseChange, EvalCaseOutcome, StageLatencyComparison } from "@/lib/evals/compare";
import { getEvalDeps } from "@/lib/evals/context";
import {
  displayCost,
  displayDate,
  displayLatency,
  displayPassRate,
  displayStageLatency,
  displayWer,
} from "@/lib/evals/format";
import { compareEvalRuns, type EvalRunComparison } from "@/lib/evals/service";
import type { EvalRunView } from "@/lib/evals/types";

export const metadata: Metadata = { title: "Compare eval runs" };

const CHANGE: Record<
  EvalCaseChange,
  { label: string; variant: "destructive" | "outline" | "secondary" }
> = {
  added: { label: "New case", variant: "outline" },
  fixed: { label: "Fixed", variant: "secondary" },
  regressed: { label: "Regressed", variant: "destructive" },
  removed: { label: "Removed", variant: "outline" },
  unchanged: { label: "Unchanged", variant: "outline" },
};

function signed(value: number, format: (value: number) => string) {
  return `${value > 0 ? "+" : ""}${format(value)}`;
}

function displayDelta(value: number | null, format: (value: number) => string) {
  return value === null ? "—" : signed(value, format);
}

function outcome(result: EvalCaseOutcome | null) {
  if (!result) {
    return "—";
  }
  return result.passed ? "Pass" : "Fail";
}

function RunSummary({ label, run }: { label: string; run: EvalRunView }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-5 shadow-xs">
      <p className="text-muted-foreground text-xs">{label}</p>
      <Link className="font-medium hover:underline" href={`/evals/${run.id}`}>
        {run.suite} · {run.agentName}
      </Link>
      <p className="text-muted-foreground text-sm">
        {displayDate(run.createdAt)} UTC · {run.modelOverride ?? "Agent default"}
      </p>
      <p className="numeric text-sm">
        {displayPassRate(run.passed, run.total)} · {displayLatency(run.avgLatencyMs)} ·{" "}
        {displayWer(run.avgWer)} WER · {displayCost(run.costUsd)}
      </p>
      <p className="numeric text-muted-foreground text-xs">
        {displayStageLatency(run.stageLatency)}
      </p>
    </div>
  );
}

function percentiles(value: StageLatencyComparison["base"]) {
  return value ? `${value.p50}/${value.p95} ms` : "—";
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompareEvalRunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let comparison: EvalRunComparison | null;
  try {
    comparison = await compareEvalRuns(
      await getEvalDeps(),
      first(params.base) ?? "",
      first(params.head) ?? ""
    );
  } catch {
    return (
      <PageContainer>
        <Link className={buttonVariants({ className: "w-fit", variant: "outline" })} href="/evals">
          <ArrowLeftIcon />
          Back to evals
        </Link>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Comparison is temporarily unavailable</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }
  if (!comparison) {
    notFound();
  }
  const { base, cases, head, stageLatency, totals } = comparison;

  return (
    <PageContainer>
      <Link className={buttonVariants({ className: "w-fit", variant: "outline" })} href="/evals">
        <ArrowLeftIcon />
        Back to evals
      </Link>
      <PageHeader
        description="Cases are matched by name. Positive latency, WER, and cost deltas mean the candidate is slower, less accurate, or more expensive."
        title="Compare eval runs"
      />
      <div className="grid gap-3 md:grid-cols-2">
        <RunSummary label="Baseline" run={base} />
        <RunSummary label="Candidate" run={head} />
      </div>
      <dl className="grid gap-3 rounded-xl border bg-card p-5 shadow-xs sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-xs">Pass rate</dt>
          <dd className="numeric text-sm">
            {displayDelta(totals.passRateDelta, (value) => `${Math.round(value * 100)} pts`)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-xs">Avg latency</dt>
          <dd className="numeric text-sm">
            {displayDelta(totals.latencyDeltaMs, (value) => `${Math.round(value)} ms`)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-xs">Avg WER</dt>
          <dd className="numeric text-sm">
            {displayDelta(totals.werDelta, (value) => `${(value * 100).toFixed(1)} pts`)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-xs">Cost</dt>
          <dd className="numeric text-sm">
            {displayDelta(totals.costDeltaUsd, (value) => `$${value.toFixed(6)}`)}
          </dd>
        </div>
      </dl>
      {stageLatency.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage (p50/p95)</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead className="text-right">p50 delta</TableHead>
                <TableHead className="text-right">p95 delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stageLatency.map((item) => (
                <TableRow key={item.stage}>
                  <TableCell>{EVAL_LATENCY_STAGE_LABELS[item.stage]}</TableCell>
                  <TableCell className="numeric">{percentiles(item.base)}</TableCell>
                  <TableCell className="numeric">{percentiles(item.head)}</TableCell>
                  <TableCell className="numeric text-right">
                    {displayDelta(item.p50DeltaMs, (value) => `${Math.round(value)} ms`)}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {displayDelta(item.p95DeltaMs, (value) => `${Math.round(value)} ms`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {cases.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          Neither run has case results yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead className="text-right">Latency delta</TableHead>
                <TableHead className="text-right">WER delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((item) => (
                <TableRow key={item.caseName}>
                  <TableCell>{item.caseName}</TableCell>
                  <TableCell>
                    <Badge variant={CHANGE[item.change].variant}>{CHANGE[item.change].label}</Badge>
                  </TableCell>
                  <TableCell>{outcome(item.base)}</TableCell>
                  <TableCell>{outcome(item.head)}</TableCell>
                  <TableCell className="numeric text-right">
                    {displayDelta(item.latencyDeltaMs, (value) => `${Math.round(value)} ms`)}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {displayDelta(item.werDelta, (value) => `${(value * 100).toFixed(1)} pts`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
