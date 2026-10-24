import type { Metadata } from "next";
import { AgentList } from "@/components/agents/agent-list";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { listAgents } from "@/lib/agents/service";
import { listAgentTemplates } from "@/lib/agents/templates";
import { getDashboardContext } from "@/lib/dashboard/context";

export const instant = false;
export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const { db, tenantId } = await getDashboardContext();
  const [agents, templates] = await Promise.all([
    listAgents({ db, tenantId }),
    listAgentTemplates(),
  ]);
  return (
    <PageContainer>
      <PageHeader
        description="Build and tune the voice receptionist your business needs. Every change is validated and versioned."
        title="Agents"
      />
      <AgentList agents={agents} templates={templates} />
    </PageContainer>
  );
}
