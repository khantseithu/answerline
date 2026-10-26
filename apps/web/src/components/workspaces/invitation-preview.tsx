"use client";

import { invitationTokenSchema } from "@answerline/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { InvitationForm } from "@/components/workspaces/invitation-form";
import type { WorkspaceInvitationView } from "@/lib/workspaces/types";

const invitationSchema = z.object({
  accountExists: z.boolean(),
  email: z.email(),
  expiresAt: z.string(),
  role: z.enum(["owner", "admin", "viewer"]),
  workspaceName: z.string(),
});
const storageKey = "answerline.workspace-invitation";

export function InvitationPreview({ signedInEmail }: { signedInEmail: string | null }) {
  const [invitation, setInvitation] = useState<WorkspaceInvitationView | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fromLink = window.location.hash.slice(1);
    const candidate = fromLink || window.sessionStorage.getItem(storageKey) || "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!invitationTokenSchema.safeParse(candidate).success) {
      window.sessionStorage.removeItem(storageKey);
      setLoading(false);
      return;
    }
    window.sessionStorage.setItem(storageKey, candidate);
    setToken(candidate);
    fetch("/api/invitations/preview", {
      body: JSON.stringify({ token: candidate }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then(async (response) => {
        if (response.ok) {
          const parsed = invitationSchema.safeParse(await response.json());
          if (parsed.success) {
            setInvitation(parsed.data);
          }
        } else {
          window.sessionStorage.removeItem(storageKey);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading invitation…</p>;
  }
  if (invitation && token) {
    return (
      <>
        <h1 className="font-semibold text-3xl tracking-tight">Join {invitation.workspaceName}</h1>
        <p className="mt-2 mb-8 text-muted-foreground text-sm/relaxed">
          Work together on your team’s AI receptionist, calls and knowledge.
        </p>
        <InvitationForm invitation={invitation} signedInEmail={signedInEmail} token={token} />
      </>
    );
  }
  return (
    <>
      <h1 className="font-semibold text-3xl tracking-tight">Invitation unavailable</h1>
      <p className="mt-2 mb-8 text-muted-foreground text-sm/relaxed">
        This link has expired, was revoked, or has already been used. Ask a workspace owner for a
        new invitation.
      </p>
      <Link
        className="text-sm underline underline-offset-4"
        href={signedInEmail ? "/overview" : "/login"}
      >
        Return to Answerline
      </Link>
    </>
  );
}
