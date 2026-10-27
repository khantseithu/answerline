import { AlertCircleIcon, ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EvalStatusBadge } from "@/components/evals/eval-status-badge";
import { RefreshWhileRunning } from "@/components/evals/refresh-while-running";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getEvalDeps } from "@/lib/evals/context";
import {
  displayCost,
  displayDate,
  displayLatency,
  displayPassRate,
  displayWer,
} from "@/lib/evals/format";
import { type EvalRunDetail, getEvalRun } from "@/lib/evals/service";
import { isEvalRunInFlight } from "@/lib/evals/types";

export const metadata: Metadata = { title: "Eval run" };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
      {children}
    </p>
  );
}

function CaseResult({ result }: { result: EvalRunDetail["results"][number] }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{result.caseName}</h3>
        <Badge variant={result.passed ? "secondary" : "destructive"}>
          {result.passed ? "Passed" : "Failed"}
        </Badge>
        <span className="numeric text-muted-foreground text-xs">
          {displayLatency(result.latencyMs)} · {displayCost(result.costUsd)}
          {result.wer === null ? "" : ` · WER ${displayWer(result.wer)}`}
        </span>
      </div>
      {result.failures.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-destructive text-sm">
          {result.failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      ) : null}
      {result.transcript.length === 0 ? (
        <Empty>No transcript was captured for this case.</Empty>
      ) : (
        <ol className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          {Array.from(result.transcript.entries(), ([position, turn]) => (
            <li className="grid grid-cols-[4rem_1fr] gap-3" key={position}>
              <span className="text-muted-foreground capitalize">{turn.role}</span>
              <span className="whitespace-pre-wrap">{turn.text}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export default async function EvalRunPage({ params }: PageProps<"/evals/[id]">) {
  const { id } = await params;
  let detail: EvalRunDetail | null;
  try {
    detail = await getEvalRun(await getEvalDeps(), id);
  } catch {
    return (
      <PageContainer>
        <Link className={buttonVariants({ className: "w-fit", variant: "outline" })} href="/evals">
          <ArrowLeftIcon />
          Back to evals
        </Link>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Eval run is temporarily unavailable</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }
  if (!detail) {
    notFound();
  }
  const { results, run } = detail;
  const inFlight = isEvalRunInFlight(run.status);

  return (
    <PageContainer>
      <RefreshWhileRunning active={inFlight} />
      <Link className={buttonVariants({ className: "w-fit", variant: "outline" })} href="/evals">
        <ArrowLeftIcon />
        Back to evals
      </Link>
      <PageHeader
        description={`${run.agentName} · ${displayDate(run.createdAt)} UTC`}
        title={`Eval run: ${run.suite}`}
      />
      {run.error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Run failed</AlertTitle>
          <AlertDescription>{run.error}</AlertDescription>
        </Alert>
      ) : null}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
        <h2 className="font-medium">Overview</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status">
            <EvalStatusBadge status={run.status} />
          </Field>
          <Field label="Passed">
            <span className="numeric">{displayPassRate(run.passed, run.total)}</span>
          </Field>
          <Field label="Avg latency">
            <span className="numeric">{displayLatency(run.avgLatencyMs)}</span>
          </Field>
          <Field label="Avg WER">
            <span className="numeric">{displayWer(run.avgWer)}</span>
          </Field>
          <Field label="Total cost">
            <span className="numeric">{displayCost(run.costUsd)}</span>
          </Field>
          <Field label="Model">
            <span className="font-mono text-xs">{run.modelOverride ?? "Agent default"}</span>
          </Field>
          <Field label="STT">
            <span className="font-mono text-xs">{run.sttOverride ?? "Agent default"}</span>
          </Field>
          <Field label="TTS">
            <span className="font-mono text-xs">{run.ttsOverride ?? "Agent default"}</span>
          </Field>
          <Field label="Mode">
            <span className="capitalize">{run.mode}</span>
          </Field>
          <Field label="Tools">{run.liveTools ? "Live" : "Mocked"}</Field>
          <Field label="Finished (UTC)">{run.finishedAt ? displayDate(run.finishedAt) : "—"}</Field>
        </dl>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Cases</h2>
        {results.length === 0 ? (
          <Empty>
            {inFlight
              ? "Results appear here as the worker finishes each case."
              : "This run has no case results."}
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {results.map((result) => (
              <CaseResult key={result.id} result={result} />
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
