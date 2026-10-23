import { BookOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { PageContainer, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Knowledge" };

export default function KnowledgePage() {
  return (
    <PageContainer>
      <PageHeader
        description="What your receptionist knows about your business: services, prices, policies, and FAQs."
        title="Knowledge"
      />
      <EmptyPanel
        description="Add PDFs, web pages, and question-and-answer pairs. During a call, the agent searches them to answer in your words."
        icon={BookOpenIcon}
        issue={43}
        title="Teach your receptionist"
      />
    </PageContainer>
  );
}
