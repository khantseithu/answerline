import { PhoneIncomingIcon } from "lucide-react";
import type { Metadata } from "next";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { PageContainer, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Calls" };

export default function CallsPage() {
  return (
    <PageContainer>
      <PageHeader
        description="Every call your receptionist answers, with its transcript, recording, and cost."
        title="Calls"
      />
      <EmptyPanel
        description="Phone and browser calls show up here after they end. You'll be able to search transcripts and filter by agent, date, or outcome."
        icon={PhoneIncomingIcon}
        issue={76}
        title="No calls to show yet"
      >
        <TalkToAgentButton variant="outline" />
      </EmptyPanel>
    </PageContainer>
  );
}
