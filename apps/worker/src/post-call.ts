import {
  agents,
  bookings,
  calls,
  callTurns,
  type Database,
  leads,
  toolCalls,
  voicemails,
} from "@answerline/db";
import { parseModelRef } from "@answerline/llm";
import type { PostCallAnalysis, PostCallJob } from "@answerline/shared";
import {
  agentConfigSchema,
  type ProviderCredentialProvider,
  postCallJobSchema,
} from "@answerline/shared";
import type { Job } from "bullmq";
import { and, asc, eq, sql } from "drizzle-orm";
import { generatePostCallAnalysis, type PostCallModelOptions } from "./post-call-model.ts";
import { resolveProviderCredential } from "./provider-credentials.ts";

const MAX_TRANSCRIPT_CHARS = 22_000;

interface Evidence {
  confirmedBooking: boolean;
  lead: boolean;
  transfer: boolean;
  voicemail: boolean;
}

export interface PostCallProcessorOptions extends PostCallModelOptions {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authoritativeOutcome(
  status: string,
  evidence: Evidence,
  proposed: PostCallAnalysis["outcome"]
) {
  if (status === "failed") {
    return "failed";
  }
  if (evidence.confirmedBooking) {
    return "booked";
  }
  if (evidence.transfer) {
    return "transferred";
  }
  if (evidence.voicemail) {
    return "voicemail";
  }
  if (evidence.lead) {
    return "follow_up";
  }
  if (
    proposed === "booked" ||
    proposed === "transferred" ||
    proposed === "voicemail" ||
    proposed === "failed"
  ) {
    return "unknown";
  }
  return proposed;
}

function transcriptInput(
  turns: { role: string; text: string }[],
  evidence: Evidence,
  actions: string[]
) {
  const transcript = turns.map((turn) => `${turn.role}: ${turn.text}`).join("\n");
  return JSON.stringify({
    actions,
    evidence,
    transcript:
      transcript.length > MAX_TRANSCRIPT_CHARS
        ? `[earlier transcript omitted]\n${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`
        : transcript,
  });
}

function analyzePostCall(db: Database, input: PostCallJob, options: PostCallProcessorOptions) {
  const env = options.env ?? process.env;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.callId}, 0))`);

    const [call] = await tx
      .select()
      .from(calls)
      .where(and(eq(calls.id, input.callId), eq(calls.tenantId, input.tenantId)))
      .for("update");
    if (!call) {
      throw new Error("Post-call call was not found for tenant");
    }
    if (call.summary !== null && call.outcome !== null && call.sentiment !== null) {
      return;
    }

    const [agent] = await tx
      .select({ config: agents.config })
      .from(agents)
      .where(and(eq(agents.id, call.agentId), eq(agents.tenantId, input.tenantId)));
    if (!agent) {
      throw new Error("Post-call agent was not found for tenant");
    }
    const config = agentConfigSchema.parse(agent.config);
    const [turns, actions, confirmedBookings, capturedLeads, savedVoicemails] = await Promise.all([
      tx
        .select({ role: callTurns.role, text: callTurns.text })
        .from(callTurns)
        .where(eq(callTurns.callId, input.callId))
        .orderBy(asc(callTurns.seq)),
      tx
        .select({ name: toolCalls.name, result: toolCalls.result, status: toolCalls.status })
        .from(toolCalls)
        .where(eq(toolCalls.callId, input.callId))
        .orderBy(asc(toolCalls.seq)),
      tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.callId, input.callId),
            eq(bookings.tenantId, input.tenantId),
            eq(bookings.status, "confirmed")
          )
        ),
      tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.callId, input.callId), eq(leads.tenantId, input.tenantId))),
      tx
        .select({ id: voicemails.id })
        .from(voicemails)
        .where(and(eq(voicemails.callId, input.callId), eq(voicemails.tenantId, input.tenantId))),
    ]);
    const evidence: Evidence = {
      confirmedBooking: confirmedBookings.length > 0,
      lead: capturedLeads.length > 0,
      transfer: actions.some(
        (action) =>
          action.name === "transfer_call" &&
          action.status === "ok" &&
          isRecord(action.result) &&
          action.result.status === "transferred"
      ),
      voicemail: savedVoicemails.length > 0,
    };
    const refs = env.POST_CALL_MODEL
      ? [env.POST_CALL_MODEL]
      : [config.models.llm.primary, ...config.models.llm.fallback];
    const providerKeys = { ...options.providerKeys };
    const deploymentKeys: Record<ProviderCredentialProvider, string | undefined> = {
      anthropic: env.ANTHROPIC_API_KEY,
      cartesia: env.CARTESIA_API_KEY,
      deepgram: env.DEEPGRAM_API_KEY,
      deepseek: env.DEEPSEEK_API_KEY,
      google: env.GOOGLE_API_KEY,
      openai: env.OPENAI_API_KEY,
      openrouter: env.OPENROUTER_API_KEY,
    };
    const providers = [...new Set(refs.map(parseModelRef).map(({ provider }) => provider))].filter(
      (provider) => provider !== "ollama" && !providerKeys[provider]
    );
    const resolvedProviderKeys = await Promise.all(
      providers.map(async (provider) => {
        if (provider === "ollama") {
          return null;
        }
        return [
          provider,
          await resolveProviderCredential(
            db,
            input.tenantId,
            provider,
            deploymentKeys[provider],
            env.PROVIDER_KEYS_ENCRYPTION_KEY
          ),
        ] as const;
      })
    );
    for (const entry of resolvedProviderKeys) {
      if (entry) {
        const [provider, key] = entry;
        if (key) {
          providerKeys[provider] = key;
        }
      }
    }
    const analysis = turns.length
      ? await generatePostCallAnalysis(
          refs,
          transcriptInput(
            turns,
            evidence,
            actions.map((action) => action.name)
          ),
          { ...options, providerKeys }
        )
      : ({
          outcome: "unknown",
          sentiment: "unknown",
          summary: "No transcript was recorded for this call.",
        } satisfies PostCallAnalysis);
    await tx
      .update(calls)
      .set({
        outcome: authoritativeOutcome(call.status, evidence, analysis.outcome),
        sentiment: analysis.sentiment,
        summary: analysis.summary,
      })
      .where(and(eq(calls.id, input.callId), eq(calls.tenantId, input.tenantId)));
  });
}

export function createPostCallProcessor(db: Database, options: PostCallProcessorOptions = {}) {
  return async (job: Job) => {
    const input = postCallJobSchema.parse(job.data);
    await analyzePostCall(db, input, options);
  };
}
