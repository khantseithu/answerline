import type {
  AgentConfig,
  CostLine,
  EvalExecutionInput,
  ModelUsage,
  QuestionAnswerPairs,
  WebhookEvent,
} from "@answerline/shared";
import {
  apiKeyScopeSchema,
  providerCredentialProviderSchema,
  WEBHOOK_EVENT_TYPES,
  workspaceRoleSchema,
} from "@answerline/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const tenantId = () =>
  uuid()
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

export const workspaceRole = pgEnum("workspace_role", workspaceRoleSchema.enum);
export const apiKeyScope = pgEnum("api_key_scope", apiKeyScopeSchema.enum);
export const providerCredentialProvider = pgEnum(
  "provider_credential_provider",
  providerCredentialProviderSchema.enum
);

export const callChannel = pgEnum("call_channel", ["web", "sip"]);
export const callDirection = pgEnum("call_direction", ["inbound", "outbound"]);
export const callStatus = pgEnum("call_status", ["in_progress", "completed", "failed"]);
export const turnRole = pgEnum("turn_role", ["caller", "agent"]);
export const toolCallStatus = pgEnum("tool_call_status", ["ok", "error", "timeout"]);
export const knowledgeSourceType = pgEnum("knowledge_source_type", ["url", "file", "qa", "text"]);
export const ingestionStatus = pgEnum("ingestion_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);
export const bookingStatus = pgEnum("booking_status", ["confirmed", "cancelled"]);
export const evalRunStatus = pgEnum("eval_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);
export const webhookEventType = pgEnum("webhook_event_type", WEBHOOK_EVENT_TYPES);
export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

export const tenants = pgTable(
  "tenants",
  {
    createdAt: createdAt(),
    id: id(),
    monthlyCallMinutesLimit: integer(),
    monthlyProviderSpendLimitUsd: numeric({ precision: 12, scale: 2 }),
    name: text().notNull(),
    slug: text().notNull().unique(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("tenants_monthly_call_minutes_nonnegative", sql`${t.monthlyCallMinutesLimit} >= 0`),
    check(
      "tenants_monthly_provider_spend_nonnegative",
      sql`${t.monthlyProviderSpendLimitUsd} >= 0`
    ),
  ]
);

export const users = pgTable("users", {
  createdAt: createdAt(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  id: id(),
  image: text(),
  name: text().notNull(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    activeTenantId: uuid().references(() => tenants.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    id: id(),
    ipAddress: text(),
    token: text().notNull().unique(),
    updatedAt: updatedAt(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index().on(t.userId)]
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    createdAt: createdAt(),
    id: id(),
    role: workspaceRole().notNull(),
    tenantId: tenantId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.userId), index().on(t.userId)]
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    acceptedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    email: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    id: id(),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole().notNull(),
    tenantId: tenantId(),
    tokenHash: text().notNull().unique(),
  },
  (t) => [
    index().on(t.tenantId),
    check("workspace_invitations_token_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("workspace_invitations_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  ]
);

export const apiKeys = pgTable(
  "api_keys",
  {
    createdAt: createdAt(),
    digest: text().notNull().unique(),
    id: id(),
    lastUsedAt: timestamp({ withTimezone: true }),
    name: text().notNull(),
    prefix: text().notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    scopes: apiKeyScope().array().notNull(),
    tenantId: tenantId(),
  },
  (t) => [
    index().on(t.tenantId),
    check("api_keys_digest", sql`${t.digest} ~ '^[0-9a-f]{64}$'`),
    check("api_keys_prefix", sql`char_length(${t.prefix}) between 1 and 16`),
    check(
      "api_keys_scopes",
      sql`cardinality(${t.scopes}) > 0 and array_position(${t.scopes}, null) is null`
    ),
  ]
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    createdAt: createdAt(),
    encryptedKey: text().notNull(),
    id: id(),
    provider: providerCredentialProvider().notNull(),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.provider), index().on(t.tenantId)]
);

export const accounts = pgTable(
  "accounts",
  {
    accessToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    accountId: text().notNull(),
    createdAt: createdAt(),
    id: id(),
    idToken: text(),
    password: text(),
    providerId: text().notNull(),
    refreshToken: text(),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    updatedAt: updatedAt(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index().on(t.userId), uniqueIndex().on(t.providerId, t.accountId)]
);

export const verifications = pgTable(
  "verifications",
  {
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    id: id(),
    identifier: text().notNull(),
    updatedAt: updatedAt(),
    value: text().notNull(),
  },
  (t) => [index().on(t.identifier)]
);

export const agents = pgTable(
  "agents",
  {
    archivedAt: timestamp({ withTimezone: true }),
    config: jsonb().$type<AgentConfig>().notNull(),
    createdAt: createdAt(),
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    version: integer().notNull().default(1),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.slug), unique().on(t.tenantId, t.id)]
);

export const agentVersions = pgTable(
  "agent_versions",
  {
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    config: jsonb().$type<AgentConfig>().notNull(),
    createdAt: createdAt(),
    id: id(),
    version: integer().notNull(),
  },
  (t) => [uniqueIndex().on(t.agentId, t.version)]
);

export const calls = pgTable(
  "calls",
  {
    agentId: uuid().notNull(),
    channel: callChannel().notNull(),
    costBreakdown: jsonb().$type<CostLine[]>(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    createdAt: createdAt(),
    direction: callDirection().notNull().default("inbound"),
    durationMs: integer(),
    endedAt: timestamp({ withTimezone: true }),
    fromNumber: text(),
    id: id(),
    modelUsage: jsonb().$type<ModelUsage[]>(),
    outcome: text(),
    recordingStartedAt: timestamp({ withTimezone: true }),
    recordingUrl: text(),
    roomName: text().notNull().unique(),
    sentiment: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    status: callStatus().notNull().default("in_progress"),
    summary: text(),
    tenantId: tenantId(),
    toNumber: text(),
    usage: jsonb().$type<Record<string, number>>(),
  },
  (t) => [
    index().on(t.tenantId, t.startedAt),
    index().on(t.agentId, t.startedAt),
    foreignKey({
      columns: [t.tenantId, t.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    unique().on(t.tenantId, t.agentId, t.id),
  ]
);

export const callTurns = pgTable(
  "call_turns",
  {
    callId: uuid()
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    endedAt: timestamp({ withTimezone: true }),
    id: id(),
    interrupted: boolean().notNull().default(false),
    latency: jsonb().$type<{ sttMs?: number; llmTtftMs?: number; ttsTtfbMs?: number }>(),
    role: turnRole().notNull(),
    seq: integer().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    text: text().notNull(),
  },
  (t) => [uniqueIndex().on(t.callId, t.seq)]
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    args: jsonb().notNull(),
    callId: uuid()
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    error: text(),
    id: id(),
    latencyMs: integer(),
    name: text().notNull(),
    result: jsonb(),
    seq: integer().notNull(),
    status: toolCallStatus().notNull(),
  },
  (t) => [uniqueIndex().on(t.callId, t.seq)]
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    agentId: uuid(),
    content: jsonb().$type<string | QuestionAnswerPairs>(),
    contentHash: text(),
    createdAt: createdAt(),
    error: text(),
    id: id(),
    ingestedAt: timestamp({ withTimezone: true }),
    status: ingestionStatus().notNull().default("pending"),
    tenantId: tenantId(),
    title: text(),
    type: knowledgeSourceType().notNull(),
    updatedAt: updatedAt(),
    uri: text(),
  },
  (t) => [
    index().on(t.tenantId),
    index().on(t.agentId),
    foreignKey({
      columns: [t.tenantId, t.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    unique().on(t.tenantId, t.id),
  ]
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    content: text().notNull(),
    createdAt: createdAt(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    id: id(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    search: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', content)`),
    seq: integer().notNull(),
    sourceId: uuid().notNull(),
    tenantId: tenantId(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.sourceId],
      foreignColumns: [knowledgeSources.tenantId, knowledgeSources.id],
    }).onDelete("cascade"),
    index().on(t.sourceId),
    index("knowledge_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("knowledge_chunks_search_idx").using("gin", t.search),
  ]
);

export const bookings = pgTable(
  "bookings",
  {
    agentId: uuid().notNull(),
    callId: uuid().references(() => calls.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    email: text(),
    endsAt: timestamp({ withTimezone: true }),
    externalId: text(),
    id: id(),
    name: text().notNull(),
    notes: text(),
    phone: text(),
    provider: text().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    status: bookingStatus().notNull().default("confirmed"),
    tenantId: tenantId(),
  },
  (t) => [
    index().on(t.tenantId, t.startsAt),
    foreignKey({
      columns: [t.tenantId, t.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.agentId, t.callId],
      foreignColumns: [calls.tenantId, calls.agentId, calls.id],
    }),
  ]
);

export const leads = pgTable(
  "leads",
  {
    agentId: uuid().notNull(),
    callId: uuid().notNull(),
    createdAt: createdAt(),
    id: id(),
    name: text().notNull(),
    phone: text().notNull(),
    reason: text().notNull(),
    tenantId: tenantId(),
  },
  (t) => [
    index().on(t.tenantId, t.createdAt),
    foreignKey({
      columns: [t.tenantId, t.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.agentId, t.callId],
      foreignColumns: [calls.tenantId, calls.agentId, calls.id],
    }).onDelete("cascade"),
  ]
);

export const voicemails = pgTable(
  "voicemails",
  {
    agentId: uuid().notNull(),
    callId: uuid().notNull(),
    createdAt: createdAt(),
    id: id(),
    message: text().notNull(),
    name: text(),
    phone: text(),
    tenantId: tenantId(),
  },
  (t) => [
    index().on(t.tenantId, t.createdAt),
    foreignKey({
      columns: [t.tenantId, t.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.agentId, t.callId],
      foreignColumns: [calls.tenantId, calls.agentId, calls.id],
    }).onDelete("cascade"),
  ]
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    agentId: uuid().notNull(),
    avgLatencyMs: integer(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    createdAt: createdAt(),
    error: text(),
    executionInput: jsonb().$type<EvalExecutionInput>(),
    finishedAt: timestamp({ withTimezone: true }),
    id: id(),
    modelOverride: text(),
    passed: integer(),
    startedAt: timestamp({ withTimezone: true }),
    status: evalRunStatus().notNull().default("queued"),
    suite: text().notNull(),
    tenantId: tenantId(),
    total: integer(),
  },
  (t) => [
    index().on(t.agentId, t.createdAt),
    foreignKey({
      columns: [t.tenantId, t.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
  ]
);

export const evalResults = pgTable(
  "eval_results",
  {
    caseName: text().notNull(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    failures: jsonb().$type<string[]>().notNull().default([]),
    id: id(),
    latencyMs: integer(),
    passed: boolean().notNull(),
    runId: uuid()
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    transcript: jsonb().$type<{ role: "caller" | "agent"; text: string }[]>().notNull(),
  },
  (t) => [index().on(t.runId)]
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    createdAt: createdAt(),
    deletedAt: timestamp({ withTimezone: true }),
    enabled: boolean().notNull().default(true),
    encryptedSecret: text().notNull(),
    events: webhookEventType().array().notNull(),
    id: id(),
    name: text().notNull(),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    url: text().notNull(),
  },
  (t) => [index().on(t.tenantId), unique().on(t.tenantId, t.id)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    attemptCount: integer().notNull().default(0),
    createdAt: createdAt(),
    deliveredAt: timestamp({ withTimezone: true }),
    endpointId: uuid().notNull(),
    eventId: text().notNull(),
    eventType: webhookEventType().notNull(),
    id: id(),
    lastError: text(),
    nextAttemptAt: timestamp({ withTimezone: true }),
    payload: jsonb().$type<WebhookEvent>().notNull(),
    replayCount: integer().notNull().default(0),
    responseBody: text(),
    responseStatus: integer(),
    status: webhookDeliveryStatus().notNull().default("pending"),
    tenantId: tenantId(),
  },
  (t) => [
    index().on(t.tenantId, t.createdAt),
    uniqueIndex().on(t.endpointId, t.eventId),
    foreignKey({
      columns: [t.tenantId, t.endpointId],
      foreignColumns: [webhookEndpoints.tenantId, webhookEndpoints.id],
    }).onDelete("cascade"),
  ]
);
