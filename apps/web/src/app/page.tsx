import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { CallApp } from "@/components/call/call-app";
import { CallConsoleVisual } from "@/components/landing/call-console-visual";
import { CtaFooter } from "@/components/landing/cta-footer";
import { FeaturesSection } from "@/components/landing/features-section";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { SiteNav } from "@/components/landing/site-nav";
import { TechnicalCredibility } from "@/components/landing/technical-credibility";
import { ValueStrip } from "@/components/landing/value-strip";
import { readOptionalSession } from "@/lib/auth/access";
import { getAuth } from "@/lib/auth/server";
import { DEFAULT_AGENT_SLUG } from "@/lib/call-token";

export const metadata: Metadata = {
  description:
    "An open-source, self-hosted AI voice receptionist. Answer phone and web calls, query your knowledge base, book appointments, and log every turn to your own Postgres.",
  title: "Answerline · Open-Source AI Voice Receptionist",
};

export default function HomePage() {
  return (
    <Suspense fallback={<Landing canCall={false} />}>
      <SessionLanding />
    </Suspense>
  );
}

async function SessionLanding() {
  const session = await readOptionalSession(await headers(), (requestHeaders) =>
    getAuth().api.getSession({ headers: requestHeaders, query: { disableRefresh: true } })
  );
  return <Landing canCall={Boolean(session)} />;
}

function Landing({ canCall }: { canCall: boolean }) {
  return (
    <CallApp agentName="Bright Smile Dental" agentSlug={DEFAULT_AGENT_SLUG} canCall={canCall}>
      <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-primary/20">
        <SiteNav />
        <main className="flex-1" id="main-content">
          <Hero />
          <CallConsoleVisual />
          <ValueStrip />
          <FeaturesSection />
          <HowItWorks />
          <TechnicalCredibility />
        </main>
        <CtaFooter />
      </div>
    </CallApp>
  );
}
