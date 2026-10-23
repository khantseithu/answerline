import type { ReactNode } from "react";
import { CallApp } from "@/components/call/call-app";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SiteHeader } from "@/components/shell/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DEFAULT_AGENT_SLUG } from "@/lib/call-token";

export default function DashboardLayout({ children }: { children: ReactNode }) {
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
