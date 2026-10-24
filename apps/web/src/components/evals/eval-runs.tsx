"use client";

import { GitCompareArrowsIcon, ListChecksIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchEvalRuns } from "@/lib/evals/client";
import { displayCost, displayDate, displayLatency, displayPassRate } from "@/lib/evals/format";
import { type EvalRunView, isEvalRunInFlight } from "@/lib/evals/types";
import { EvalStatusBadge } from "./eval-status-badge";
import { type EvalRunOptions, NewRunDialog } from "./new-run-dialog";

const POLL_INTERVAL_MS = 2000;

function runLabel(run: EvalRunView) {
  return `${run.suite} · ${run.agentName} · ${displayDate(run.createdAt)}`;
}

function CompareForm({ runs }: { runs: EvalRunView[] }) {
  const comparable = runs.filter((run) => run.status === "completed");
  if (comparable.length < 2) {
    return null;
  }
  return (
    <form
      action="/evals/compare"
      className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:grid-cols-[1fr_1fr_auto]"
      method="get"
    >
      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor="compare-base">Baseline run</label>
        <NativeSelect defaultValue={comparable[1]?.id} id="compare-base" name="base">
          {comparable.map((run) => (
            <NativeSelectOption key={run.id} value={run.id}>
              {runLabel(run)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor="compare-head">Candidate run</label>
        <NativeSelect defaultValue={comparable[0]?.id} id="compare-head" name="head">
          {comparable.map((run) => (
            <NativeSelectOption key={run.id} value={run.id}>
              {runLabel(run)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex items-end">
        <Button type="submit" variant="outline">
          <GitCompareArrowsIcon data-icon="inline-start" />
          Compare
        </Button>
      </div>
    </form>
  );
}

export function EvalRuns({
  initialRuns,
  options,
}: {
  initialRuns: EvalRunView[];
  options: EvalRunOptions;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const inFlight = runs.some((run) => isEvalRunInFlight(run.status));

  const refresh = useCallback(async () => {
    const next = await fetchEvalRuns().catch(() => null);
    if (next) {
      setRuns(next);
    }
  }, []);

  const handleCreated = useCallback((run: EvalRunView) => {
    setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
  }, []);

  useEffect(() => {
    if (!inFlight) {
      return;
    }
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inFlight, refresh]);

  let emptyDescription =
    "Queue a run to replay a suite of scripted calls against an agent and score the answers.";
  if (options.agents.length === 0) {
    emptyDescription = "Create an agent before running evals.";
  } else if (options.suites.length === 0) {
    emptyDescription = "Add an eval suite to the repository evals folder to get started.";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {runs.length} {runs.length === 1 ? "run" : "runs"}
          {inFlight ? " · updating while runs are in progress" : ""}
        </p>
        <NewRunDialog onCreated={handleCreated} options={options} />
      </div>
      {runs.length === 0 ? (
        <EmptyPanel
          description={emptyDescription}
          icon={ListChecksIcon}
          title="Check changes before callers hear them"
        />
      ) : (
        <>
          <CompareForm runs={runs} />
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created (UTC)</TableHead>
                  <TableHead>Suite</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Passed</TableHead>
                  <TableHead>Avg latency</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link className="hover:underline" href={`/evals/${run.id}`}>
                        {displayDate(run.createdAt)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{run.suite}</TableCell>
                    <TableCell>{run.agentName}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {run.modelOverride ?? "Agent default"}
                    </TableCell>
                    <TableCell>
                      <EvalStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="numeric">
                      {displayPassRate(run.passed, run.total)}
                    </TableCell>
                    <TableCell className="numeric">{displayLatency(run.avgLatencyMs)}</TableCell>
                    <TableCell className="numeric text-right">{displayCost(run.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
