import { readFile } from "node:fs/promises";
import {
  agents,
  calls,
  callTurns,
  type Database,
  leads,
  tenants,
  toolCalls,
  voicemails,
} from "@answerline/db";
import {
  type CallEventJob,
  callEventJob,
  type PostCallJob,
  parseAgentConfig,
  postCallJobSchema,
} from "@answerline/shared";
import type { Job, Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import { calculateCallCost, parseCostPrices } from "./costs.ts";

const defaultAgentsDir = new URL("../../../agents/", import.meta.url);

export interface PersistOptions {
  agentsDir?: URL;
  postCallDelayMs?: number;
  postCallQueue?: Queue<PostCallJob>;
}

const POST_CALL_DELAY_MS = 5000;

interface Ref {
  agentId: string;
  tenantId: string;
}

async function resolveTenantId(db: Database, slug: string) {
  await db.insert(tenants).values({ name: slug, slug }).onConflictDoNothing();
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) {
    throw new Error(`tenant "${slug}" could not be resolved`);
  }
  return tenant.id;
}

async function readAgentYaml(slug: string, agentsDir: URL) {
  try {
    return await readFile(new URL(`${slug}.yaml`, agentsDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `agent "${slug}" not found in the database and agents/${slug}.yaml does not exist`,
        { cause: error }
      );
    }
    throw error;
  }
}

async function resolveAgentId(db: Database, tenantId: string, slug: string, agentsDir: URL) {
  const find = async () => {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.slug, slug)));
    return agent?.id;
  };

  const existing = await find();
  if (existing) {
    return existing;
  }

  const config = parseAgentConfig(await readAgentYaml(slug, agentsDir));
  await db
    .insert(agents)
    .values({ config, name: config.name, slug, tenantId })
    .onConflictDoNothing();
  const created = await find();
  if (!created) {
    throw new Error(`agent "${slug}" could not be resolved`);
  }
  return created;
}

async function resolveRef(db: Database, event: CallEventJob, options: PersistOptions) {
  const tenantId = await resolveTenantId(db, event.tenant);
  const agentId = await resolveAgentId(
    db,
    tenantId,
    event.agent,
    options.agentsDir ?? defaultAgentsDir
  );
  return { agentId, tenantId } satisfies Ref;
}

async function ensureCallId(
  db: Database,
  event: CallEventJob,
  ref: Ref,
  startedAt: Date,
  label: string = event.type
) {
  const [row] = await db
    .insert(calls)
    .values({ ...ref, channel: "web", roomName: event.room_name, startedAt })
    .onConflictDoUpdate({
      set: { roomName: event.room_name },
      setWhere: and(eq(calls.tenantId, ref.tenantId), eq(calls.agentId, ref.agentId)),
      target: calls.roomName,
    })
    .returning({ id: calls.id });
  if (!row) {
    throw new Error(`${label} call reference does not match the tenant and agent`);
  }
  return row.id;
}

async function handleStarted(
  db: Database,
  event: Extract<CallEventJob, { type: "call.started" }>,
  ref: Ref
) {
  const fields = {
    channel: event.channel,
    direction: event.direction,
    fromNumber: event.from_number,
    startedAt: new Date(event.started_at),
    toNumber: event.to_number,
  };
  const [call] = await db
    .insert(calls)
    .values({ ...ref, ...fields, roomName: event.room_name })
    .onConflictDoUpdate({
      set: fields,
      setWhere: and(eq(calls.tenantId, ref.tenantId), eq(calls.agentId, ref.agentId)),
      target: calls.roomName,
    })
    .returning({ id: calls.id });
  if (!call) {
    throw new Error("call.started call reference does not match the tenant and agent");
  }
}

async function handleTurn(
  db: Database,
  event: Extract<CallEventJob, { type: "call.turn" }>,
  ref: Ref
) {
  const startedAt = new Date(event.started_at);
  const callId = await ensureCallId(db, event, ref, startedAt);
  await db
    .insert(callTurns)
    .values({
      callId,
      endedAt: event.ended_at ? new Date(event.ended_at) : null,
      interrupted: event.interrupted,
      latency: event.latency
        ? {
            llmTtftMs: event.latency.llm_ttft_ms,
            sttMs: event.latency.stt_ms,
            ttsTtfbMs: event.latency.tts_ttfb_ms,
          }
        : null,
      role: event.role,
      seq: event.seq,
      startedAt,
      text: event.text,
    })
    .onConflictDoNothing({ target: [callTurns.callId, callTurns.seq] });
}

async function handleTool(
  db: Database,
  event: Extract<CallEventJob, { type: "call.tool" }>,
  ref: Ref
) {
  const startedAt = new Date(event.started_at);
  const callId = await ensureCallId(db, event, ref, startedAt);
  await db
    .insert(toolCalls)
    .values({
      args: event.args,
      callId,
      createdAt: startedAt,
      error: event.error,
      latencyMs: event.latency_ms,
      name: event.name,
      result: event.result,
      seq: event.seq,
      status: event.status,
    })
    .onConflictDoNothing({ target: [toolCalls.callId, toolCalls.seq] });
}

async function handleEnded(
  db: Database,
  event: Extract<CallEventJob, { type: "call.ended" }>,
  ref: Ref,
  options: PersistOptions
) {
  const endedAt = new Date(event.ended_at);
  const { costUsd, costBreakdown } = calculateCallCost(
    event.model_usage,
    parseCostPrices(process.env.COST_PRICES_JSON)
  );
  const fields = {
    costBreakdown,
    costUsd: costUsd?.toFixed(6) ?? null,
    durationMs: event.duration_ms,
    endedAt,
    modelUsage: event.model_usage ?? null,
    recordingStartedAt: event.recording_started_at
      ? new Date(event.recording_started_at)
      : undefined,
    recordingUrl: event.recording_url,
    status: event.status,
    usage: event.usage,
  };
  const [call] = await db
    .insert(calls)
    .values({
      ...ref,
      ...fields,
      channel: "web",
      roomName: event.room_name,
      startedAt: new Date(endedAt.getTime() - event.duration_ms),
    })
    .onConflictDoUpdate({
      set: fields,
      setWhere: and(eq(calls.tenantId, ref.tenantId), eq(calls.agentId, ref.agentId)),
      target: calls.roomName,
    })
    .returning({ id: calls.id });
  if (!call) {
    throw new Error("call.ended call reference does not match the tenant and agent");
  }
  if (options.postCallQueue) {
    await options.postCallQueue.add(
      "analyze",
      postCallJobSchema.parse({ callId: call.id, tenantId: ref.tenantId }),
      {
        attempts: 3,
        backoff: { delay: 1000, type: "exponential" },
        delay: options.postCallDelayMs ?? POST_CALL_DELAY_MS,
        jobId: `postcall_${call.id}`,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      }
    );
  }
}

async function handleVoicemail(
  db: Database,
  event: Extract<CallEventJob, { type: "voicemail.created" }>,
  ref: Ref
) {
  const createdAt = new Date(event.created_at);
  const callId = await ensureCallId(db, event, ref, createdAt, "voicemail");
  await db
    .insert(voicemails)
    .values({
      ...ref,
      callId,
      createdAt,
      id: event.voicemail_id,
      message: event.message,
      name: event.name,
      phone: event.phone,
    })
    .onConflictDoNothing({ target: voicemails.id });
}

async function handleLead(
  db: Database,
  event: Extract<CallEventJob, { type: "lead.created" }>,
  ref: Ref
) {
  const createdAt = new Date(event.created_at);
  const callId = await ensureCallId(db, event, ref, createdAt, "lead");
  await db
    .insert(leads)
    .values({
      ...ref,
      callId,
      createdAt,
      id: event.lead_id,
      name: event.name,
      phone: event.phone,
      reason: event.reason,
    })
    .onConflictDoNothing({ target: leads.id });
}

export async function persistCallEvent(
  db: Database,
  event: CallEventJob,
  options: PersistOptions = {}
) {
  const ref = await resolveRef(db, event, options);
  switch (event.type) {
    case "call.started":
      await handleStarted(db, event, ref);
      break;
    case "call.turn":
      await handleTurn(db, event, ref);
      break;
    case "call.tool":
      await handleTool(db, event, ref);
      break;
    case "lead.created":
      await handleLead(db, event, ref);
      break;
    case "voicemail.created":
      await handleVoicemail(db, event, ref);
      break;
    case "call.ended":
      await handleEnded(db, event, ref, options);
      break;
    default:
      break;
  }
}

export function createCallEventProcessor(db: Database, options: PersistOptions = {}) {
  return async (job: Job) => {
    await persistCallEvent(db, callEventJob.parse(job.data), options);
  };
}
