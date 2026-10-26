"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workspaceRequest } from "@/lib/workspaces/client";
import type { WorkspaceView } from "@/lib/workspaces/types";

export function WorkspaceSwitcher({
  workspace,
  workspaces,
}: {
  workspace: WorkspaceView;
  workspaces: WorkspaceView[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const items = workspaces.map((item) => ({ label: item.name, value: item.id }));
  const switchTo = useCallback(
    async (next: string | null) => {
      if (!next || next === workspace.id) {
        return;
      }
      setPending(true);
      setError("");
      try {
        await workspaceRequest("/api/v1/workspaces/switch", "POST", { workspaceId: next });
        window.location.assign("/overview");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to switch workspace");
        setPending(false);
      }
    },
    [workspace.id]
  );
  return (
    <div className="flex min-w-0 flex-col gap-2 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between px-1 text-muted-foreground text-xs">
        <span>Workspace</span>
        <span className="capitalize">{workspace.role}</span>
      </div>
      <Select disabled={pending} items={items} onValueChange={switchTo} value={workspace.id}>
        <SelectTrigger aria-label="Switch workspace" className="w-full bg-sidebar">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        className="justify-start text-muted-foreground"
        nativeButton={false}
        render={<Link href="/workspaces/new" />}
        size="sm"
        variant="ghost"
      >
        <PlusIcon />
        New workspace
      </Button>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
