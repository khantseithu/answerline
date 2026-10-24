import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { ThemeSelect } from "@/components/theme/theme-toggle";

export const instant = false;
export const metadata: Metadata = { title: "Settings" };

const PROVIDER_KEYS = [
  { env: "DEEPGRAM_API_KEY", stage: "Speech-to-text" },
  { env: "ANTHROPIC_API_KEY", stage: "Language model" },
  { env: "CARTESIA_API_KEY", stage: "Text-to-speech" },
];

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

export default function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader
        description="Preferences for this dashboard and this deployment."
        title="Settings"
      />
      <div className="flex flex-col divide-y">
        <SettingsSection
          description="Match your system, or pick a theme for this browser."
          title="Appearance"
        >
          <ThemeSelect />
        </SettingsSection>
        <SettingsSection
          description="Answerline calls each provider with your own key, read from the server's .env file. Nothing is billed through Answerline."
          title="Provider keys"
        >
          <ul className="flex flex-col divide-y overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/6">
            {PROVIDER_KEYS.map((key) => (
              <li
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                key={key.env}
              >
                <span className="text-sm">{key.stage}</span>
                <code className="numeric text-muted-foreground text-xs">{key.env}</code>
              </li>
            ))}
          </ul>
        </SettingsSection>
      </div>
    </PageContainer>
  );
}
