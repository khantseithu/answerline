import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { InvitationPreview } from "@/components/workspaces/invitation-preview";
import { getSessionContext } from "@/lib/auth/context";
import { DashboardAuthError } from "@/lib/dashboard/errors";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Workspace invitation",
};

async function InvitationView() {
  const context = await getSessionContext().catch((error: unknown) => {
    if (error instanceof DashboardAuthError) {
      return null;
    }
    throw error;
  });
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="px-6 py-5 sm:px-10">
        <Link aria-label="Answerline home" className="text-primary" href="/">
          <Logo />
        </Link>
      </header>
      <section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <InvitationPreview signedInEmail={context?.user.email ?? null} />
      </section>
    </main>
  );
}

export default function InvitationPage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted-foreground text-sm">Loading invitation…</p>}>
      <InvitationView />
    </Suspense>
  );
}
