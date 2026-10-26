import { createHash, randomBytes } from "node:crypto";
import { apiKeys, type Database } from "@answerline/db";
import {
  type ApiKeyScope,
  apiKeyScopeSchema,
  createApiKeySchema,
  workspaceIdSchema,
} from "@answerline/shared";
import { and, eq, isNull } from "drizzle-orm";
import {
  lockOwnerWorkspace,
  requireOwnerWorkspace,
  type WorkspaceDeps,
} from "@/lib/workspaces/service";

const tokenSchema = /^al_[A-Za-z0-9_-]{43}$/;

export class ApiKeyNotFoundError extends Error {}
export class ApiKeyScopeError extends Error {}

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function listApiKeys(deps: WorkspaceDeps, rawTenantId: string) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  return deps.db.transaction(async (tx) => {
    await requireOwnerWorkspace(tx, deps, tenantId);
    return tx
      .select({
        createdAt: apiKeys.createdAt,
        id: apiKeys.id,
        lastUsedAt: apiKeys.lastUsedAt,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        revokedAt: apiKeys.revokedAt,
        scopes: apiKeys.scopes,
      })
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, tenantId))
      .orderBy(apiKeys.createdAt);
  });
}

export function createApiKey(deps: WorkspaceDeps, rawTenantId: string, rawInput: unknown) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  const input = createApiKeySchema.parse(rawInput);
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    const token = `al_${randomBytes(32).toString("base64url")}`;
    const [key] = await tx
      .insert(apiKeys)
      .values({
        digest: digest(token),
        name: input.name,
        prefix: token.slice(0, 11),
        scopes: input.scopes,
        tenantId,
      })
      .returning({ id: apiKeys.id });
    if (!key) {
      throw new Error("API key creation returned no row");
    }
    return { id: key.id, token };
  });
}

export function revokeApiKey(deps: WorkspaceDeps, rawTenantId: string, rawKeyId: string) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  const keyId = workspaceIdSchema.parse(rawKeyId);
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    const [key] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (key) {
      return;
    }
    const [existing] = await tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId)));
    if (!existing) {
      throw new ApiKeyNotFoundError("API key not found");
    }
  });
}

export function authenticateApiKey(db: Database, token: string) {
  if (!tokenSchema.test(token)) {
    return null;
  }
  const keyDigest = digest(token);
  return db.transaction(async (tx) => {
    const [key] = await tx
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(apiKeys.digest, keyDigest), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id, scopes: apiKeys.scopes, tenantId: apiKeys.tenantId });
    return key ?? null;
  });
}

export function requireApiKeyScope(scopes: ApiKeyScope[], rawScope: string) {
  const scope = apiKeyScopeSchema.parse(rawScope);
  if (!scopes.includes(scope)) {
    throw new ApiKeyScopeError("API key does not have the required scope");
  }
}
