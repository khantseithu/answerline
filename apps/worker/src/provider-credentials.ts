import { type Database, providerCredentials } from "@answerline/db";
import { decryptProviderCredential } from "@answerline/llm";
import type { ProviderCredentialProvider } from "@answerline/shared";
import { and, eq } from "drizzle-orm";

export async function resolveProviderCredential(
  db: Database,
  tenantId: string,
  provider: ProviderCredentialProvider,
  deploymentKey: string | undefined,
  encryptionKey: string | undefined
) {
  const [credential] = await db
    .select({ encryptedKey: providerCredentials.encryptedKey })
    .from(providerCredentials)
    .where(
      and(eq(providerCredentials.tenantId, tenantId), eq(providerCredentials.provider, provider))
    )
    .limit(1);
  if (credential) {
    if (!encryptionKey) {
      throw new Error("PROVIDER_KEYS_ENCRYPTION_KEY is required to use workspace provider keys");
    }
    return decryptProviderCredential(credential.encryptedKey, encryptionKey);
  }
  return deploymentKey?.trim() || undefined;
}

export async function resolveTenantProviderKeys(
  db: Database,
  tenantId: string,
  deploymentKeys: Partial<Record<ProviderCredentialProvider, string | undefined>>,
  encryptionKey: string | undefined
) {
  const credentials = await db
    .select({
      encryptedKey: providerCredentials.encryptedKey,
      provider: providerCredentials.provider,
    })
    .from(providerCredentials)
    .where(eq(providerCredentials.tenantId, tenantId));
  const keys = Object.fromEntries(
    Object.entries(deploymentKeys).flatMap(([provider, key]) =>
      key?.trim() ? [[provider, key.trim()]] : []
    )
  ) as Partial<Record<ProviderCredentialProvider, string>>;
  for (const credential of credentials) {
    if (!encryptionKey) {
      throw new Error("PROVIDER_KEYS_ENCRYPTION_KEY is required to use workspace provider keys");
    }
    keys[credential.provider] = decryptProviderCredential(credential.encryptedKey, encryptionKey);
  }
  return keys;
}
