import { agentIdSchema } from "@answerline/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentEditor } from "@/components/agents/agent-editor";
import { PageContainer } from "@/components/shell/page-header";
import { AgentNotFoundError, getAgent, listAgentVersions } from "@/lib/agents/service";
import { getDashboardContext } from "@/lib/dashboard/context";

export const metadata: Metadata = { title: "Edit agent" };

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  if (!agentIdSchema.safeParse(id).success) {
    notFound();
  }
  const { db, role, tenantId } = await getDashboardContext();
  try {
    const deps = { db, tenantId };
    const [agent, versions] = await Promise.all([getAgent(deps, id), listAgentVersions(deps, id)]);
    return (
      <PageContainer>
        <AgentEditor agent={agent} initialVersions={versions} readOnly={role === "viewer"} />
      </PageContainer>
    );
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      notFound();
    }
    throw error;
  }
}
