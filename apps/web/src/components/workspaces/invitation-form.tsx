"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { z } from "zod";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";
import { workspaceRequest } from "@/lib/workspaces/client";
import type { WorkspaceInvitationView } from "@/lib/workspaces/types";

const signupResponse = z.object({ email: z.email() });

export function InvitationForm({
  invitation,
  signedInEmail,
  token,
}: {
  invitation: WorkspaceInvitationView;
  signedInEmail: string | null;
  token: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const needsSignup = !(signedInEmail || invitation.accountExists);
  const loginUrl = "/login?returnTo=%2Finvite";
  const accept = useCallback(async () => {
    setPending(true);
    setError("");
    try {
      await workspaceRequest("/api/v1/workspaces/accept", "POST", { token });
      window.sessionStorage.removeItem("answerline.workspace-invitation");
      window.location.assign("/overview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to accept invitation");
      setPending(false);
    }
  }, [token]);
  const signup = useCallback(
    async (formData: FormData) => {
      setPending(true);
      setError("");
      const password = String(formData.get("password") ?? "");
      try {
        const response = await workspaceRequest("/api/invitations/signup", "POST", {
          name: String(formData.get("name") ?? ""),
          password,
          token,
        });
        const { email } = signupResponse.parse(await response.json());
        window.sessionStorage.removeItem("answerline.workspace-invitation");
        const result = await authClient.signIn.email({ email, password });
        if (result.error) {
          setError("Your account was created. Sign in to open your workspace.");
          setPending(false);
          return;
        }
        window.location.assign("/overview");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to create account");
        setPending(false);
      }
    },
    [token]
  );
  if (signedInEmail && signedInEmail.toLowerCase() !== invitation.email) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm/relaxed">
          You’re signed in as {signedInEmail}. Sign out, then sign in with {invitation.email} to
          accept this invitation.
        </p>
        <SignOutButton destination={loginUrl} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl bg-muted/50 px-4 py-3">
        <p className="break-all font-medium text-sm">{invitation.email}</p>
        <p className="mt-1 text-muted-foreground text-xs">
          Invited as <span className="capitalize">{invitation.role}</span>
        </p>
      </div>
      {signedInEmail ? (
        <Button disabled={pending} onClick={accept}>
          {pending ? "Joining workspace…" : "Accept invitation"}
        </Button>
      ) : null}
      {!signedInEmail && invitation.accountExists ? (
        <Button nativeButton={false} render={<Link href={loginUrl} />}>
          Sign in to accept
        </Button>
      ) : null}
      {needsSignup ? (
        <form action={signup} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-name">Your name</Label>
            <Input
              autoComplete="name"
              disabled={pending}
              id="invite-name"
              maxLength={100}
              name="name"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-password">Create a password</Label>
            <Input
              autoComplete="new-password"
              disabled={pending}
              id="invite-password"
              maxLength={128}
              minLength={12}
              name="password"
              required
              type="password"
            />
            <p className="text-muted-foreground text-xs">Use at least 12 characters.</p>
          </div>
          <Button disabled={pending} type="submit">
            {pending ? "Creating account…" : "Create account and join"}
          </Button>
          <p className="text-center text-muted-foreground text-xs">
            Already have an account?{" "}
            <Link className="text-foreground underline underline-offset-4" href={loginUrl}>
              Sign in
            </Link>
          </p>
        </form>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
