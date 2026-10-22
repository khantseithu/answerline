import type { AgentConfig } from "@answerline/shared";
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
  id: id(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agents = pgTable(
  "agents",
  {
    id: id(),
    tenantId: tenantId(),
    slug: text().notNull(),
    name: text().notNull(),
    config: jsonb().$type<AgentConfig>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.slug)],
);

export const calls = pgTable(
  "calls",
  {
    id: id(),
    tenantId: tenantId(),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    roomName: text().notNull().unique(),
    channel: callChannel().notNull(),
    direction: callDirection().notNull().default("inbound"),
    status: callStatus().notNull().default("in_progress"),
    fromNumber: text(),
    toNumber: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true }),
    durationMs: integer(),
    recordingUrl: text(),
    summary: text(),
    outcome: text(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    usage: jsonb().$type<Record<string, number>>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.startedAt), index().on(t.agentId, t.startedAt)],
);

export const callTurns = pgTable(
  "call_turns",
  {
    id: id(),
    callId: uuid()
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    role: turnRole().notNull(),
    text: text().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
    latency: jsonb().$type<{ sttMs?: number; llmTtftMs?: number; ttsTtfbMs?: number }>(),
    interrupted: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex().on(t.callId, t.seq)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: id(),
    callId: uuid()
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    name: text().notNull(),
    args: jsonb().notNull(),
    result: jsonb(),
    status: toolCallStatus().notNull(),
    error: text(),
    latencyMs: integer(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.callId)],
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: id(),
    tenantId: tenantId(),
    agentId: uuid().references(() => agents.id, { onDelete: "cascade" }),
    type: knowledgeSourceType().notNull(),
    uri: text(),
    title: text(),
    contentHash: text(),
    status: ingestionStatus().notNull().default("pending"),
    error: text(),
    ingestedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.tenantId), index().on(t.agentId)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    tenantId: tenantId(),
    sourceId: uuid()
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    content: text().notNull(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    search: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', content)`),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.sourceId),
    index("knowledge_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("knowledge_chunks_search_idx").using("gin", t.search),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    tenantId: tenantId(),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    callId: uuid().references(() => calls.id, { onDelete: "set null" }),
    provider: text().notNull(),
    externalId: text(),
    status: bookingStatus().notNull().default("confirmed"),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }),
    name: text().notNull(),
    phone: text(),
    email: text(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.startsAt)],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: id(),
    tenantId: tenantId(),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    suite: text().notNull(),
    status: evalRunStatus().notNull().default("queued"),
    modelOverride: text(),
    passed: integer(),
    total: integer(),
    avgLatencyMs: integer(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.agentId, t.createdAt)],
);

export const evalResults = pgTable(
  "eval_results",
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    caseName: text().notNull(),
    passed: boolean().notNull(),
    failures: jsonb().$type<string[]>().notNull().default([]),
    transcript: jsonb().$type<{ role: "caller" | "agent"; text: string }[]>().notNull(),
    latencyMs: integer(),
    costUsd: numeric({ precision: 12, scale: 6 }),
  },
  (t) => [index().on(t.runId)],
);
