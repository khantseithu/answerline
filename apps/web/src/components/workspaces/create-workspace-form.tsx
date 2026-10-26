"use client";

import { type MouseEvent, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { workspaceRequest } from "@/lib/workspaces/client";
import type { WorkspaceView } from "@/lib/workspaces/types";

export function CreateWorkspaceForm({ workspaces }: { workspaces: WorkspaceView[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const create = useCallback(async (formData: FormData) => {
    setPending(true);
    setError("");
    try {
      await workspaceRequest("/api/v1/workspaces", "POST", {
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
      });
      window.location.assign("/overview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create workspace");
      setPending(false);
    }
  }, []);
  const switchTo = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    const { workspaceId } = event.currentTarget.dataset;
    if (!workspaceId) {
      return;
    }
    setPending(true);
    setError("");
    try {
      await workspaceRequest("/api/v1/workspaces/switch", "POST", { workspaceId });
      window.location.assign("/overview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to switch workspace");
      setPending(false);
    }
  }, []);
  return (
    <div className="flex flex-col gap-8">
      <form action={create} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="workspace-name">Workspace name</Label>
          <Input
            autoComplete="organization"
            disabled={pending}
            id="workspace-name"
            maxLength={100}
            name="name"
            placeholder="Bright Smile Dental"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="workspace-slug">Workspace slug</Label>
          <Input
            aria-describedby="workspace-slug-help"
            autoCapitalize="none"
            autoComplete="off"
            disabled={pending}
            id="workspace-slug"
            maxLength={63}
            name="slug"
            pattern="[a-z0-9][a-z0-9-]{0,62}"
            placeholder="bright-smile"
            required
          />
          <p className="text-muted-foreground text-xs/relaxed" id="workspace-slug-help">
            A unique identifier using lowercase letters, numbers and hyphens.
          </p>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <Button disabled={pending} type="submit">
          {pending ? "Opening workspace…" : "Create workspace"}
        </Button>
      </form>
      {workspaces.length > 0 ? (
        <div className="flex flex-col gap-3 border-t pt-6">
          <h2 className="font-medium text-sm">Or open an existing workspace</h2>
          {workspaces.map((workspace) => (
            <Button
              className="justify-between"
              data-workspace-id={workspace.id}
              disabled={pending}
              key={workspace.id}
              onClick={switchTo}
              variant="outline"
            >
              <span>{workspace.name}</span>
              <span className="text-muted-foreground text-xs capitalize">{workspace.role}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
