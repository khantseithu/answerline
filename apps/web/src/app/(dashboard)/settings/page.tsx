import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { ThemeSelect } from "@/components/theme/theme-toggle";
import { ApiKeyManager } from "@/components/workspaces/api-key-manager";
import { ProviderKeyManager } from "@/components/workspaces/provider-key-manager";
import { WorkspaceSettingsManager } from "@/components/workspaces/workspace-settings";
import { getDashboardContext } from "@/lib/dashboard/context";
import { getWorkspaceSettings } from "@/lib/workspaces/service";

export const instant = false;
export const metadata: Metadata = { title: "Settings" };

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 py-8 first:pt-0 md:grid-cols-[minmax(0,18rem)_1fr] md:gap-10">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-base">{title}</h2>
        <p className="text-muted-foreground text-sm/relaxed">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const context = await getDashboardContext();
  const settings =
    context.role === "owner" ? await getWorkspaceSettings(context, context.tenantId) : null;
  return (
    <PageContainer>
      <PageHeader
        description="Manage your workspace, team and dashboard preferences."
        title="Settings"
      />
      <div className="flex flex-col divide-y">
        <SettingsSection
          description="A shared space for your agents, calls and knowledge."
          title="Workspace"
        >
          {settings ? (
            <WorkspaceSettingsManager settings={settings} userId={context.user.id} />
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium text-sm">{context.workspace.name}</h3>
              <p className="text-muted-foreground text-sm">
                Your role is <span className="capitalize">{context.role}</span>. Only workspace
                owners can manage members and settings.
              </p>
            </div>
          )}
        </SettingsSection>
        {context.role === "owner" ? (
          <SettingsSection
            description="Create scoped credentials for scripts and integrations."
            title="API access"
          >
            <ApiKeyManager tenantId={context.tenantId} />
          </SettingsSection>
        ) : null}
        <SettingsSection
          description="Match your system, or pick a theme for this browser."
          title="Appearance"
        >
          <ThemeSelect />
        </SettingsSection>
        <SettingsSection
          description="Use workspace-specific provider credentials or fall back to deployment keys."
          title="Provider keys"
        >
          {context.role === "owner" ? (
            <ProviderKeyManager tenantId={context.tenantId} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Only workspace owners can manage provider keys.
            </p>
          )}
        </SettingsSection>
      </div>
    </PageContainer>
  );
}
