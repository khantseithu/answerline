"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { GitHubIcon } from "@/components/brand/github-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

export function LoginForm({
  githubEnabled,
  destination,
  ready,
  oauthError,
}: {
  githubEnabled: boolean;
  destination: string;
  ready: boolean;
  oauthError: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(
    oauthError ? "GitHub sign-in failed. Try again or use email and password." : ""
  );

  const signIn = useCallback(
    async (formData: FormData) => {
      setPending(true);
      setError("");
      try {
        const result = await authClient.signIn.email({
          email: String(formData.get("email") ?? ""),
          password: String(formData.get("password") ?? ""),
        });
        if (result.error) {
          setError("Email or password is incorrect.");
          return;
        }
        router.replace(destination);
        router.refresh();
      } catch {
        setError("Unable to sign in. Please try again.");
      } finally {
        setPending(false);
      }
    },
    [destination, router]
  );

  const signInWithGitHub = useCallback(async () => {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        callbackURL: destination,
        errorCallbackURL: `/login?error=oauth&returnTo=${encodeURIComponent(destination)}`,
        provider: "github",
      });
      if (result.error) {
        setError("GitHub sign-in is unavailable. Try email and password.");
        setPending(false);
      }
    } catch {
      setError("Unable to connect to GitHub. Please try again.");
      setPending(false);
    }
  }, [destination]);

  return (
    <div className="flex flex-col gap-6">
      {!ready && (
        <p
          className="rounded-lg border border-border bg-muted px-3 py-2 text-muted-foreground text-sm"
          role="status"
        >
          Sign-in is not ready. Ask your administrator to complete setup.
        </p>
      )}
      <form action={signIn} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            autoComplete="username"
            className="h-10"
            disabled={pending || !ready}
            id="email"
            name="email"
            required
            type="email"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            autoComplete="current-password"
            className="h-10"
            disabled={pending || !ready}
            id="password"
            maxLength={128}
            name="password"
            required
            type="password"
          />
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="h-10 w-full" disabled={pending || !ready} type="submit">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {githubEnabled ? (
        <>
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span className="h-px flex-1 bg-border" />
            <span>or continue with</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            className="h-10 w-full"
            disabled={pending || !ready}
            onClick={signInWithGitHub}
            type="button"
            variant="outline"
          >
            <GitHubIcon /> GitHub
          </Button>
        </>
      ) : null}
    </div>
  );
}
