import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { env } from "@/env";
import { getAuth } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Sign in" };

async function LoginView({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ready = Boolean(env.DATABASE_URL && env.BETTER_AUTH_SECRET);
  if (
    ready &&
    (await getAuth().api.getSession({
      headers: await headers(),
      query: { disableRefresh: true },
    }))
  ) {
    redirect("/overview");
  }
  const params = await searchParams;
  return (
    <main className="relative flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link aria-label="Answerline home" className="text-primary" href="/">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <section aria-labelledby="sign-in-title" className="w-full max-w-sm">
          <p className="mb-3 font-medium text-primary text-xs uppercase tracking-[0.18em]">
            Your receptionist, your infrastructure
          </p>
          <h1 className="font-semibold text-3xl tracking-tight" id="sign-in-title">
            Welcome back
          </h1>
          <p className="mt-2 mb-8 text-muted-foreground text-sm/relaxed">
            Sign in to review calls and manage your agents.
          </p>
          <LoginForm
            githubEnabled={Boolean(env.AUTH_GITHUB_CLIENT_ID && env.AUTH_GITHUB_CLIENT_SECRET)}
            oauthError={Boolean(params.error)}
            ready={ready}
          />
          <p className="mt-7 border-border border-t pt-5 text-muted-foreground text-xs/relaxed">
            Use the account provided by your administrator. Public registration is disabled.
          </p>
        </section>
      </div>
      <p className="pb-6 text-center text-muted-foreground text-xs">
        Self-hosted. Under your control.
      </p>
    </main>
  );
}

export default function LoginPage(props: { searchParams: Promise<{ error?: string }> }) {
  return (
    <Suspense fallback={<p className="p-6 text-muted-foreground text-sm">Loading sign-in…</p>}>
      <LoginView {...props} />
    </Suspense>
  );
}
