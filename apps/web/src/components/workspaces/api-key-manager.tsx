"use client";

import type { ApiKeyScope } from "@answerline/shared";
import { CopyIcon, KeyRoundIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { workspaceRequest } from "@/lib/workspaces/client";

const scopes: { label: string; value: ApiKeyScope }[] = [
  { label: "Read calls", value: "calls:read" },
  { label: "Read agents", value: "agents:read" },
  { label: "Manage agents", value: "agents:write" },
  { label: "Read knowledge", value: "knowledge:read" },
  { label: "Manage knowledge", value: "knowledge:write" },
  { label: "Read evals", value: "evals:read" },
  { label: "Run evals", value: "evals:write" },
];

const apiKeySchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  lastUsedAt: z.iso.datetime().nullable(),
  name: z.string(),
  prefix: z.string(),
  revokedAt: z.iso.datetime().nullable(),
  scopes: z.array(z.enum(scopes.map(({ value }) => value) as [ApiKeyScope, ...ApiKeyScope[]])),
});
const listResponseSchema = z.object({ keys: z.array(apiKeySchema) });
const createResponseSchema = z.object({ id: z.uuid(), token: z.string() });

export function ApiKeyManager({ tenantId }: { tenantId: string }) {
  const base = `/api/v1/workspaces/${tenantId}/api-keys`;
  const [keys, setKeys] = useState<z.infer<typeof apiKeySchema>[]>([]);
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([
    "calls:read",
    "agents:read",
  ]);
  const [newToken, setNewToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Unable to load API keys");
    }
    setKeys(listResponseSchema.parse(await response.json()).keys);
  }, [base]);

  useEffect(() => {
    const load = async () => {
      try {
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load API keys");
      }
    };
    load().catch(() => undefined);
  }, [refresh]);

  const create = useCallback(
    async (formData: FormData) => {
      setPending(true);
      setError("");
      try {
        const response = await workspaceRequest(base, "POST", {
          name: String(formData.get("name") ?? ""),
          scopes: selectedScopes,
        });
        setNewToken(createResponseSchema.parse(await response.json()).token);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to create API key");
      } finally {
        setPending(false);
      }
    },
    [base, refresh, selectedScopes]
  );

  const revoke = useCallback(
    async (id: string) => {
      setPending(true);
      setError("");
      try {
        await workspaceRequest(`${base}/${id}`, "DELETE");
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to revoke API key");
      } finally {
        setPending(false);
      }
    },
    [base, refresh]
  );

  const toggleScope = useCallback((scope: ApiKeyScope) => {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]
    );
  }, []);

  const copyToken = useCallback(async () => {
    await navigator.clipboard.writeText(newToken);
  }, [newToken]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="flex items-center gap-2 font-medium text-sm">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          Workspace API keys
        </h3>
        <p className="mt-1 text-muted-foreground text-xs/relaxed">
          Keys are shown once at creation. Choose only the access each integration needs.
        </p>
      </div>
      <form action={create} className="flex flex-col gap-3">
        <Label htmlFor="api-key-name">Key name</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-40 flex-1"
            disabled={pending}
            id="api-key-name"
            maxLength={100}
            name="name"
            placeholder="Production integration"
            required
          />
          <Button disabled={pending || selectedScopes.length === 0} type="submit">
            Create key
          </Button>
        </div>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
          <legend className="mb-2 font-medium text-xs">Permissions</legend>
          {scopes.map((scope) => (
            <ScopeOption
              checked={selectedScopes.includes(scope.value)}
              disabled={pending}
              key={scope.value}
              onToggle={toggleScope}
              scope={scope}
            />
          ))}
        </fieldset>
      </form>
      {newToken ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <Label htmlFor="new-api-key">Copy your API key now</Label>
          <div className="flex gap-2">
            <Input
              className="min-w-0 flex-1 font-mono text-xs"
              id="new-api-key"
              readOnly
              value={newToken}
            />
            <Button onClick={copyToken} size="icon" title="Copy API key" variant="outline">
              <CopyIcon />
              <span className="sr-only">Copy API key</span>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">This secret will not be shown again.</p>
        </div>
      ) : null}
      <ul className="divide-y rounded-xl bg-card px-4 shadow-xs ring-1 ring-foreground/6">
        {keys.map((key) => (
          <ApiKeyRow key={key.id} onRevoke={revoke} pending={pending} record={key} />
        ))}
        {keys.length === 0 ? (
          <li className="py-4 text-muted-foreground text-xs">No API keys yet.</li>
        ) : null}
      </ul>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ScopeOption({
  checked,
  disabled,
  onToggle,
  scope,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: (scope: ApiKeyScope) => void;
  scope: (typeof scopes)[number];
}) {
  const handleChange = useCallback(() => onToggle(scope.value), [onToggle, scope.value]);
  return (
    <label className="flex items-center gap-2 text-muted-foreground text-xs">
      <input checked={checked} disabled={disabled} onChange={handleChange} type="checkbox" />
      {scope.label}
    </label>
  );
}

function ApiKeyRow({
  onRevoke,
  pending,
  record,
}: {
  onRevoke: (id: string) => Promise<void>;
  pending: boolean;
  record: z.infer<typeof apiKeySchema>;
}) {
  const handleRevoke = useCallback(() => onRevoke(record.id), [onRevoke, record.id]);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <p className="font-medium text-sm">{record.name}</p>
        <p className="font-mono text-muted-foreground text-xs">{record.prefix}…</p>
        <p className="mt-1 text-muted-foreground text-xs">
          {record.scopes.join(", ")} ·{" "}
          {record.lastUsedAt
            ? `Last used ${new Date(record.lastUsedAt).toLocaleString()}`
            : "Never used"}
        </p>
      </div>
      {record.revokedAt ? (
        <span className="text-muted-foreground text-xs">Revoked</span>
      ) : (
        <Button disabled={pending} onClick={handleRevoke} size="sm" variant="outline">
          <Trash2Icon /> Revoke
        </Button>
      )}
    </li>
  );
}
