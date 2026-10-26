import { z } from "zod";

export const callStartedEvent = z.object({
  agent_id: z.string(),
  call_id: z.string(),
  channel: z.enum(["web", "sip"]),
  from: z.string().optional(),
  started_at: z.iso.datetime(),
  type: z.literal("call.started"),
});

export const callEndedEvent = z.object({
  agent_id: z.string(),
  call_id: z.string(),
  duration_ms: z.number().int().nonnegative(),
  ended_at: z.iso.datetime(),
  type: z.literal("call.ended"),
});

export const bookingCreatedEvent = z.object({
  agent_id: z.string(),
  call_id: z.string(),
  name: z.string(),
  phone: z.string().optional(),
  starts_at: z.iso.datetime(),
  type: z.literal("booking.created"),
});

export const answerlineEvent = z.discriminatedUnion("type", [
  callStartedEvent,
  callEndedEvent,
  bookingCreatedEvent,
]);

export type AnswerlineEvent = z.infer<typeof answerlineEvent>;

export const QUEUES = {
  callEvents: "call-events",
  evals: "evals",
  ingestion: "ingestion",
  outboundCalls: "outbound-calls",
  postCall: "post-call",
} as const;
