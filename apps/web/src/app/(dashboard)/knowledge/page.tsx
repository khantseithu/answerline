import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { KnowledgeManager } from "@/components/knowledge/knowledge-manager";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getKnowledgeDeps } from "@/lib/knowledge/context";
import { listKnowledgeSources } from "@/lib/knowledge/service";

export const metadata: Metadata = { title: "Knowledge" };

async function KnowledgeContent() {
  await connection();
  const sources = await listKnowledgeSources(await getKnowledgeDeps());
  return <KnowledgeManager initialSources={sources} />;
}

function KnowledgeFallback() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-80 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <PageContainer>
      <PageHeader
        description="What your receptionist knows about your business: services, prices, policies, and FAQs."
        title="Knowledge"
      />
      <Suspense fallback={<KnowledgeFallback />}>
        <KnowledgeContent />
      </Suspense>
    </PageContainer>
  );
}
