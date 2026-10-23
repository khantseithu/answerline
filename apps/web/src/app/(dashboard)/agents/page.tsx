import { HeadsetIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { PageContainer, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <PageContainer>
      <PageHeader
        description="An agent is one YAML file: its greeting, instructions, models, tools, and hours."
        title="Agents"
      />
      <EmptyPanel
        description={
          <>
            Edit{" "}
            <code className="numeric rounded-md bg-card px-1.5 py-0.5 text-foreground text-xs ring-1 ring-foreground/6">
              agents/bright-smile-dental.yaml
            </code>{" "}
            and restart the agent to change how it answers. Editing here, with validation and
            version history, comes next.
          </>
        }
        icon={HeadsetIcon}
        issue={80}
        title="Agents are configured in your repo for now"
      />
    </PageContainer>
  );
}
