import { AlertCircleIcon } from "lucide-react";
import type { Metadata } from "next";
import { EvalRuns } from "@/components/evals/eval-runs";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getEvalDeps } from "@/lib/evals/context";
import { listEvalOptions, listEvalRuns } from "@/lib/evals/service";

export const instant = false;
export const metadata: Metadata = { title: "Evals" };

const DESCRIPTION = "Scripted test calls, scored for accuracy, tool use, latency, and cost.";

export default async function EvalsPage() {
  let loaded: {
    options: Awaited<ReturnType<typeof listEvalOptions>>;
    runs: Awaited<ReturnType<typeof listEvalRuns>>;
  };
  try {
    const deps = await getEvalDeps();
    const [runs, options] = await Promise.all([listEvalRuns(deps), listEvalOptions(deps)]);
    loaded = { options, runs };
  } catch {
    return (
      <PageContainer>
        <PageHeader description={DESCRIPTION} title="Evals" />
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Evals are temporarily unavailable</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader description={DESCRIPTION} title="Evals" />
      <EvalRuns initialRuns={loaded.runs} options={loaded.options} />
    </PageContainer>
  );
}
