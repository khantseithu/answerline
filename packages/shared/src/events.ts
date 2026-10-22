import { z } from "zod";

export const callStartedEvent = z.object({
  type: z.literal("call.started"),
  call_id: z.string(),
  agent_id: z.string(),
  channel: z.enum(["web", "sip"]),
  from: z.string().optional(),
  started_at: z.iso.datetime(),
});

export const callEndedEvent = z.object({
  type: z.literal("call.ended"),
  call_id: z.string(),
  agent_id: z.string(),
  ended_at: z.iso.datetime(),
  duration_ms: z.number().int().nonnegative(),
});

export const bookingCreatedEvent = z.object({
  type: z.literal("booking.created"),
  call_id: z.string(),
  agent_id: z.string(),
  starts_at: z.iso.datetime(),
  name: z.string(),
  phone: z.string().optional(),
});

export const answerlineEvent = z.discriminatedUnion("type", [
  callStartedEvent,
  callEndedEvent,
  bookingCreatedEvent,
]);

export type AnswerlineEvent = z.infer<typeof answerlineEvent>;

export const QUEUES = {
  ingestion: "ingestion",
  postCall: "post-call",
  evals: "evals",
} as const;
