"use client";

import type { WorkspaceRole } from "@answerline/shared";
import { CopyIcon, LinkIcon, UserPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { workspaceRequest } from "@/lib/workspaces/client";
import type { WorkspaceSettings } from "@/lib/workspaces/types";
import { RoleSelect } from "./role-select";

const invitationResponse = z.object({ url: z.url() });

export function WorkspaceSettingsManager({
  settings,
  userId,
}: {
  settings: WorkspaceSettings;
  userId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("viewer");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const base = `/api/v1/workspaces/${settings.workspace.id}`;

  const run = useCallback(
    async (operation: () => Promise<unknown>) => {
      setPending(true);
      setError("");
      try {
        await operation();
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to update workspace");
      } finally {
        setPending(false);
      }
    },
    [router]
  );
  const rename = useCallback(
    async (formData: FormData) => {
      await run(() =>
        workspaceRequest(base, "PATCH", { name: String(formData.get("name") ?? "") })
      );
    },
    [base, run]
  );
  const invite = useCallback(
    async (formData: FormData) => {
      await run(async () => {
        const response = await workspaceRequest(`${base}/invitations`, "POST", {
          email: String(formData.get("email") ?? ""),
          role: inviteRole,
        });
        setInviteUrl(invitationResponse.parse(await response.json()).url);
        setCopied(false);
      });
    },
    [base, inviteRole, run]
  );
  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError("Select and copy the invitation link below.");
    }
  }, [inviteUrl]);
  return (
    <div className="flex flex-col gap-8">
      <form action={rename} className="flex flex-col gap-3">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-40 flex-1"
            defaultValue={settings.workspace.name}
            disabled={pending}
            id="workspace-name"
            maxLength={100}
            name="name"
            required
          />
          <Button disabled={pending} type="submit" variant="outline">
            Save name
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Workspace slug: <code>{settings.workspace.slug}</code>
        </p>
      </form>
      <div className="flex flex-col gap-4 border-t pt-6">
        <div>
          <h3 className="font-medium text-sm">Members</h3>
          <p className="mt-1 text-muted-foreground text-xs/relaxed">
            Owners manage members and settings. Admins manage agents and calls. Viewers can read
            workspace data.
          </p>
        </div>
        <ul className="divide-y rounded-xl bg-card px-4 shadow-xs ring-1 ring-foreground/6">
          {settings.members.map((member) => (
            <MemberRow
              base={base}
              key={member.userId}
              member={member}
              pending={pending}
              run={run}
              userId={userId}
            />
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-4 border-t pt-6">
        <div>
          <h3 className="flex items-center gap-2 font-medium text-sm">
            <UserPlusIcon className="size-4 text-muted-foreground" />
            Invite a member
          </h3>
          <p className="mt-1 text-muted-foreground text-xs/relaxed">
            Create a link for one email address. Share it directly; links expire in seven days.
          </p>
        </div>
        <form action={invite} className="flex flex-col gap-3">
          <Label htmlFor="invite-email">Email address</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              autoComplete="email"
              className="min-w-40 flex-1"
              disabled={pending}
              id="invite-email"
              name="email"
              placeholder="teammate@example.com"
              required
              type="email"
            />
            <RoleSelect
              disabled={pending}
              label="Invitation role"
              onChange={setInviteRole}
              value={inviteRole}
            />
            <Button disabled={pending} type="submit">
              <LinkIcon />
              Create link
            </Button>
          </div>
        </form>
        {inviteUrl ? (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
            <Label htmlFor="invitation-link">Invitation link</Label>
            <div className="flex gap-2">
              <Input
                className="min-w-0 flex-1 text-xs"
                id="invitation-link"
                readOnly
                value={inviteUrl}
              />
              <Button onClick={copyLink} size="icon" title="Copy invitation link" variant="outline">
                <CopyIcon />
                <span className="sr-only">Copy invitation link</span>
              </Button>
            </div>
            <p className="text-muted-foreground text-xs" role="status">
              {copied ? "Link copied." : "Copy this link now. It is only shown once."}
            </p>
          </div>
        ) : null}
        {settings.invitations.length > 0 ? (
          <ul className="divide-y rounded-xl bg-card px-4 shadow-xs ring-1 ring-foreground/6">
            {settings.invitations.map((invitation) => (
              <InvitationRow
                base={base}
                invitation={invitation}
                key={invitation.id}
                pending={pending}
                run={run}
              />
            ))}
          </ul>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {pending ? (
        <p className="text-muted-foreground text-xs" role="status">
          Saving workspace changes…
        </p>
      ) : null}
    </div>
  );
}

type Run = (operation: () => Promise<unknown>) => Promise<void>;

function MemberRow({
  base,
  member,
  pending,
  run,
  userId,
}: {
  base: string;
  member: WorkspaceSettings["members"][number];
  pending: boolean;
  run: Run;
  userId: string;
}) {
  const changeRole = useCallback(
    (role: WorkspaceRole) =>
      run(() => workspaceRequest(`${base}/members/${member.userId}`, "PATCH", { role })),
    [base, member.userId, run]
  );
  const remove = useCallback(
    () => run(() => workspaceRequest(`${base}/members/${member.userId}`, "DELETE")),
    [base, member.userId, run]
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <p className="font-medium text-sm">
          {member.name}
          {member.userId === userId ? " (you)" : ""}
        </p>
        <p className="break-all text-muted-foreground text-xs">{member.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <RoleSelect
          disabled={pending}
          label={`Role for ${member.email}`}
          onChange={changeRole}
          value={member.role}
        />
        <Button
          className="text-destructive"
          disabled={pending}
          onClick={remove}
          size="sm"
          variant="ghost"
        >
          Remove<span className="sr-only"> {member.email}</span>
        </Button>
      </div>
    </li>
  );
}

function InvitationRow({
  base,
  invitation,
  pending,
  run,
}: {
  base: string;
  invitation: WorkspaceSettings["invitations"][number];
  pending: boolean;
  run: Run;
}) {
  const revoke = useCallback(
    () => run(() => workspaceRequest(`${base}/invitations/${invitation.id}`, "DELETE")),
    [base, invitation.id, run]
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="break-all text-sm">{invitation.email}</p>
        <p className="text-muted-foreground text-xs">
          <span className="capitalize">{invitation.role}</span> · Expires{" "}
          {new Date(invitation.expiresAt).toLocaleDateString()}
        </p>
      </div>
      <Button disabled={pending} onClick={revoke} size="sm" variant="outline">
        Revoke<span className="sr-only"> invitation for {invitation.email}</span>
      </Button>
    </li>
  );
}
