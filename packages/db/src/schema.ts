import type { AgentConfig, CostLine, ModelUsage, QuestionAnswerPairs } from "@answerline/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
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

export const tenants = pgTable("tenants", {
  createdAt: createdAt(),
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  updatedAt: updatedAt(),
});

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
    config: jsonb().$type<AgentConfig>().notNull(),
    createdAt: createdAt(),
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    version: integer().notNull().default(1),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.slug)]
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
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
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
  (t) => [index().on(t.tenantId, t.startedAt), index().on(t.agentId, t.startedAt)]
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
    agentId: uuid().references(() => agents.id, { onDelete: "cascade" }),
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
  (t) => [index().on(t.tenantId), index().on(t.agentId)]
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
    sourceId: uuid()
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    tenantId: tenantId(),
  },
  (t) => [
    index().on(t.sourceId),
    index("knowledge_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("knowledge_chunks_search_idx").using("gin", t.search),
  ]
);

export const bookings = pgTable(
  "bookings",
  {
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
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
  (t) => [index().on(t.tenantId, t.startsAt)]
);

export const leads = pgTable(
  "leads",
  {
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    callId: uuid()
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    id: id(),
    name: text().notNull(),
    phone: text().notNull(),
    reason: text().notNull(),
    tenantId: tenantId(),
  },
  (t) => [index().on(t.tenantId, t.createdAt)]
);

export const voicemails = pgTable(
  "voicemails",
  {
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    callId: uuid()
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    id: id(),
    message: text().notNull(),
    name: text(),
    phone: text(),
    tenantId: tenantId(),
  },
  (t) => [index().on(t.tenantId, t.createdAt)]
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    avgLatencyMs: integer(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    createdAt: createdAt(),
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
  (t) => [index().on(t.agentId, t.createdAt)]
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
