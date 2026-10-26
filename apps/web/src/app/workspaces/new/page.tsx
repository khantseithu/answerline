import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/brand/logo";
import { CreateWorkspaceForm } from "@/components/workspaces/create-workspace-form";
import { getSessionContext } from "@/lib/auth/context";
import { DashboardAuthError } from "@/lib/dashboard/errors";
import { listWorkspaces } from "@/lib/workspaces/service";

export const metadata: Metadata = { title: "Create a workspace" };

async function WorkspaceOnboarding() {
  const context = await getSessionContext().catch((error: unknown) => {
    if (error instanceof DashboardAuthError) {
      redirect("/login");
    }
    throw error;
  });
  const workspaces = await listWorkspaces(context);
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link aria-label="Answerline home" className="text-primary" href="/">
          <Logo />
        </Link>
        <SignOutButton />
      </header>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <p className="mb-3 font-medium text-primary text-xs uppercase tracking-[0.18em]">
          A place for your team
        </p>
        <h1 className="font-semibold text-3xl tracking-tight">Create a workspace</h1>
        <p className="mt-2 mb-8 text-muted-foreground text-sm/relaxed">
          Keep your agents, calls and knowledge together. Invite your team when you’re ready.
        </p>
        <CreateWorkspaceForm workspaces={workspaces} />
      </div>
    </main>
  );
}

export default function NewWorkspacePage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted-foreground text-sm">Loading workspaces…</p>}>
      <WorkspaceOnboarding />
    </Suspense>
  );
}
