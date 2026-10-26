import { type Database, providerCredentials } from "@answerline/db";
import { decryptProviderCredential, encryptProviderCredential } from "@answerline/llm";
import {
  type ProviderCredentialProvider,
  providerCredentialProviderSchema,
  setProviderCredentialSchema,
  workspaceIdSchema,
} from "@answerline/shared";
import { and, eq } from "drizzle-orm";
import { env } from "@/env";
import { lockOwnerWorkspace, type WorkspaceDeps } from "@/lib/workspaces/service";

export class ProviderCredentialEncryptionUnavailableError extends Error {}

function encryptionKey() {
  const key = env.PROVIDER_KEYS_ENCRYPTION_KEY;
  if (!key) {
    throw new ProviderCredentialEncryptionUnavailableError(
      "Configure PROVIDER_KEYS_ENCRYPTION_KEY before saving workspace provider keys"
    );
  }
  return key;
}

export function listProviderCredentials(deps: WorkspaceDeps, rawTenantId: string) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    return tx
      .select({ provider: providerCredentials.provider, updatedAt: providerCredentials.updatedAt })
      .from(providerCredentials)
      .where(eq(providerCredentials.tenantId, tenantId))
      .orderBy(providerCredentials.provider);
  });
}

export function setProviderCredential(deps: WorkspaceDeps, rawTenantId: string, rawInput: unknown) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  const input = setProviderCredentialSchema.parse(rawInput);
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    const encryptedKey = encryptProviderCredential(input.key, encryptionKey());
    await tx
      .insert(providerCredentials)
      .values({ encryptedKey, provider: input.provider, tenantId })
      .onConflictDoUpdate({
        set: { encryptedKey, updatedAt: new Date() },
        target: [providerCredentials.tenantId, providerCredentials.provider],
      });
  });
}

export function deleteProviderCredential(
  deps: WorkspaceDeps,
  rawTenantId: string,
  rawProvider: string
) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  const provider = providerCredentialProviderSchema.parse(rawProvider);
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    await tx
      .delete(providerCredentials)
      .where(
        and(eq(providerCredentials.tenantId, tenantId), eq(providerCredentials.provider, provider))
      );
  });
}

export async function getProviderCredential(
  db: Database,
  tenantId: string,
  provider: ProviderCredentialProvider,
  key?: string
) {
  const [credential] = await db
    .select({ encryptedKey: providerCredentials.encryptedKey })
    .from(providerCredentials)
    .where(
      and(
        eq(providerCredentials.tenantId, workspaceIdSchema.parse(tenantId)),
        eq(providerCredentials.provider, provider)
      )
    )
    .limit(1);
  return credential
    ? decryptProviderCredential(credential.encryptedKey, key ?? encryptionKey())
    : undefined;
}

export function deploymentProviderKey(
  provider: ProviderCredentialProvider,
  source: NodeJS.ProcessEnv = process.env
) {
  const providerEnv: Record<ProviderCredentialProvider, string | undefined> = {
    anthropic: source.ANTHROPIC_API_KEY,
    cartesia: source.CARTESIA_API_KEY,
    deepgram: source.DEEPGRAM_API_KEY,
    deepseek: source.DEEPSEEK_API_KEY,
    google: source.GOOGLE_API_KEY,
    openai: source.OPENAI_API_KEY,
    openrouter: source.OPENROUTER_API_KEY,
  };
  return providerEnv[provider];
}
