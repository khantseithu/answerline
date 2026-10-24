import { redirect } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { CallApp } from "@/components/call/call-app";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SiteHeader } from "@/components/shell/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DEFAULT_AGENT_SLUG } from "@/lib/call-token";
import { getDashboardContext } from "@/lib/dashboard/context";
import { DashboardAuthError } from "@/lib/dashboard/errors";

async function AuthenticatedDashboard({ children }: { children: ReactNode }) {
  try {
    await getDashboardContext();
  } catch (error) {
    if (error instanceof DashboardAuthError) {
      redirect("/login");
    }
    throw error;
  }
  return (
    <CallApp agentName="Bright Smile Dental" agentSlug={DEFAULT_AGENT_SLUG}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <SiteHeader />
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
