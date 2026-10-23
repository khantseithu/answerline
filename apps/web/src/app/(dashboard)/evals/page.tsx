import { ListChecksIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { PageContainer, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Evals" };

export default function EvalsPage() {
  return (
    <PageContainer>
      <PageHeader
        description="Scripted test calls, scored for accuracy, tool use, latency, and cost."
        title="Evals"
      />
      <EmptyPanel
        description="Evals replay test calls against your agent and score the answers, so you can change a prompt or a model and know it still books the appointment."
        icon={ListChecksIcon}
        issue={88}
        title="Check changes before callers hear them"
      />
    </PageContainer>
  );
}
