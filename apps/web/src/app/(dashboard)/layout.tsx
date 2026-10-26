import { agents } from "@answerline/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { CallApp } from "@/components/call/call-app";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SiteHeader } from "@/components/shell/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DEFAULT_AGENT_SLUG } from "@/lib/call-token";
import { getDashboardContext } from "@/lib/dashboard/context";
import { DashboardAuthError, WorkspaceRequiredError } from "@/lib/dashboard/errors";
import { listWorkspaces } from "@/lib/workspaces/service";

async function dashboardContext() {
  try {
    return await getDashboardContext();
  } catch (error) {
    if (error instanceof DashboardAuthError) {
      redirect("/login");
    }
    if (error instanceof WorkspaceRequiredError) {
      redirect("/workspaces/new");
    }
    throw error;
  }
}

async function AuthenticatedDashboard({ children }: { children: ReactNode }) {
  const context = await dashboardContext();
  const workspaces = await listWorkspaces(context);
  const [callAgent] = await context.db
    .select({ name: agents.name, slug: agents.slug })
    .from(agents)
    .where(and(eq(agents.tenantId, context.tenantId), isNull(agents.archivedAt)))
    .orderBy(
      asc(sql`case when ${agents.slug} = ${DEFAULT_AGENT_SLUG} then 0 else 1 end`),
      asc(agents.name)
    )
    .limit(1);
  const canCall = context.role !== "viewer" && Boolean(callAgent);
  const unavailableReason =
    context.role === "viewer"
      ? "Your viewer role has read-only access to this workspace."
      : "Create an agent to try a browser call in this workspace.";
  return (
    <CallApp
      agentName={callAgent?.name ?? "No agents yet"}
      agentSlug={callAgent?.slug ?? ""}
      canCall={canCall}
      key={context.tenantId}
      unavailableReason={canCall ? null : unavailableReason}
    >
      <SidebarProvider>
        <AppSidebar workspace={context.workspace} workspaces={workspaces} />
        <SidebarInset className="min-w-0">
          <SiteHeader readOnly={context.role === "viewer"} />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </CallApp>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="p-6 text-muted-foreground text-sm">Loading dashboard…</p>}>
      <AuthenticatedDashboard>{children}</AuthenticatedDashboard>
    </Suspense>
  );
}
