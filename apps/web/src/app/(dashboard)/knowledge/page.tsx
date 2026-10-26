import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { KnowledgeManager } from "@/components/knowledge/knowledge-manager";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardContext } from "@/lib/dashboard/context";
import { getKnowledgeDeps } from "@/lib/knowledge/context";
import { listKnowledgeSources } from "@/lib/knowledge/service";

export const instant = false;
export const metadata: Metadata = { title: "Knowledge" };

async function KnowledgeContent() {
  await connection();
  const { role } = await getDashboardContext();
  const sources = await listKnowledgeSources(await getKnowledgeDeps());
  return <KnowledgeManager initialSources={sources} readOnly={role === "viewer"} />;
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
