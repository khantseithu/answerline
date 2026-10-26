"use client";

import type { ProviderCredentialProvider } from "@answerline/shared";
import { KeyRoundIcon, Trash2Icon } from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { workspaceRequest } from "@/lib/workspaces/client";

const providers = [
  { label: "Anthropic", value: "anthropic" },
  { label: "Cartesia", value: "cartesia" },
  { label: "Deepgram", value: "deepgram" },
  { label: "DeepSeek", value: "deepseek" },
  { label: "Google", value: "google" },
  { label: "OpenAI", value: "openai" },
  { label: "OpenRouter", value: "openrouter" },
] as const satisfies { label: string; value: ProviderCredentialProvider }[];

const credentialSchema = z.object({
  hasDeploymentKey: z.boolean(),
  hasWorkspaceKey: z.boolean(),
  provider: z.enum(
    providers.map(({ value }) => value) as [
      ProviderCredentialProvider,
      ...ProviderCredentialProvider[],
    ]
  ),
});
const responseSchema = z.object({ providers: z.array(credentialSchema) });

export function ProviderKeyManager({ tenantId }: { tenantId: string }) {
  const base = `/api/v1/workspaces/${tenantId}/provider-keys`;
  const [credentials, setCredentials] = useState<z.infer<typeof credentialSchema>[]>([]);
  const [keys, setKeys] = useState<Partial<Record<ProviderCredentialProvider, string>>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const updateKey = useCallback((provider: ProviderCredentialProvider, key: string) => {
    setKeys((current) => ({ ...current, [provider]: key }));
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Unable to load provider keys");
    }
    setCredentials(responseSchema.parse(await response.json()).providers);
  }, [base]);

  useEffect(() => {
    refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Unable to load provider keys");
    });
  }, [refresh]);

  const save = useCallback(
    async (provider: ProviderCredentialProvider) => {
      const key = keys[provider]?.trim();
      if (!key) {
        setError("Enter a provider key first");
        return;
      }
      setPending(true);
      setError("");
      try {
        await workspaceRequest(base, "PUT", { key, provider });
        setKeys((current) => ({ ...current, [provider]: "" }));
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to save provider key");
      } finally {
        setPending(false);
      }
    },
    [base, keys, refresh]
  );

  const remove = useCallback(
    async (provider: ProviderCredentialProvider) => {
      setPending(true);
      setError("");
      try {
        await workspaceRequest(`${base}/${provider}`, "DELETE");
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to remove provider key");
      } finally {
        setPending(false);
      }
    },
    [base, refresh]
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="flex items-center gap-2 font-medium text-sm">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          Provider credentials
        </h3>
        <p className="mt-1 text-muted-foreground text-xs/relaxed">
          Workspace keys are encrypted at rest. If you remove one, Answerline uses the deployment
          key when available.
        </p>
      </div>
      <ul className="divide-y rounded-xl bg-card px-4 shadow-xs ring-1 ring-foreground/6">
        {providers.map(({ label, value }) => {
          const credential = credentials.find((entry) => entry.provider === value);
          return (
            <ProviderKeyRow
              credential={credential}
              key={value}
              keyValue={keys[value] ?? ""}
              label={label}
              onKeyChange={updateKey}
              onRemove={remove}
              onSave={save}
              pending={pending}
              provider={value}
            />
          );
        })}
      </ul>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ProviderKeyRow({
  credential,
  keyValue,
  label,
  onKeyChange,
  onRemove,
  onSave,
  pending,
  provider,
}: {
  credential: z.infer<typeof credentialSchema> | undefined;
  keyValue: string;
  label: string;
  onKeyChange: (provider: ProviderCredentialProvider, key: string) => void;
  onRemove: (provider: ProviderCredentialProvider) => Promise<void>;
  onSave: (provider: ProviderCredentialProvider) => Promise<void>;
  pending: boolean;
  provider: ProviderCredentialProvider;
}) {
  let status = "No key configured";
  if (credential?.hasDeploymentKey) {
    status = "Using deployment key";
  }
  if (credential?.hasWorkspaceKey) {
    status = "Workspace key saved";
  }
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onKeyChange(provider, event.currentTarget.value),
    [onKeyChange, provider]
  );
  const handleSave = useCallback(() => onSave(provider), [onSave, provider]);
  const handleRemove = useCallback(() => onRemove(provider), [onRemove, provider]);

  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={`provider-key-${provider}`}>{label}</Label>
        <span className="text-muted-foreground text-xs">{status}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          autoComplete="new-password"
          className="min-w-40 flex-1"
          disabled={pending}
          id={`provider-key-${provider}`}
          onChange={handleChange}
          placeholder={credential?.hasWorkspaceKey ? "Replace saved key" : "Provider API key"}
          type="password"
          value={keyValue}
        />
        <Button disabled={pending || !keyValue.trim()} onClick={handleSave} type="button">
          Save key
        </Button>
        {credential?.hasWorkspaceKey ? (
          <Button
            aria-label={`Remove ${label} workspace key`}
            disabled={pending}
            onClick={handleRemove}
            size="icon"
            type="button"
            variant="outline"
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
