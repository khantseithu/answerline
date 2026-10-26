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
  webhookDeliveries: "webhook-deliveries",
} as const;

export const WEBHOOK_EVENT_TYPES = [
  "booking.created",
  "call.ended",
  "call.started",
  "eval.completed",
  "lead.created",
] as const;

export const webhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

const webhookAgent = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const webhookTimestamp = z.iso.datetime({ offset: true });
const webhookCallStartedData = z.object({
  agent: webhookAgent,
  call_id: z.uuid(),
  channel: z.enum(["web", "sip"]),
  direction: z.enum(["inbound", "outbound"]),
  from_number: z.string().optional(),
  started_at: webhookTimestamp,
  to_number: z.string().optional(),
});
const webhookCallEndedData = z.object({
  agent: webhookAgent,
  call_id: z.uuid(),
  duration_ms: z.number().int().nonnegative(),
  ended_at: webhookTimestamp,
  recording_url: z.string().min(1).optional(),
  status: z.enum(["completed", "failed"]),
  transcript_url: z.url({ protocol: /^https?$/ }),
});
const webhookBookingCreatedData = bookingCreatedEvent
  .omit({ type: true })
  .extend({ agent_id: z.uuid(), call_id: z.uuid(), starts_at: webhookTimestamp });
const webhookEvalCompletedData = z.object({
  agent_id: z.uuid(),
  avg_latency_ms: z.number().int().nonnegative().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  eval_run_id: z.uuid(),
  passed: z.number().int().nonnegative(),
  status: z.literal("completed"),
  suite: z.string().min(1),
  total: z.number().int().positive(),
});
const webhookLeadCreatedData = z.object({
  agent: webhookAgent,
  call_id: z.uuid(),
  lead_id: z.uuid(),
  name: z.string().min(1),
  phone: z.string().min(1),
  reason: z.string().min(1),
});
const webhookEnvelope = {
  created_at: webhookTimestamp,
  id: z.string().min(1),
};

export const webhookEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...webhookEnvelope,
    data: webhookBookingCreatedData,
    type: z.literal("booking.created"),
  }),
  z.object({ ...webhookEnvelope, data: webhookCallEndedData, type: z.literal("call.ended") }),
  z.object({ ...webhookEnvelope, data: webhookCallStartedData, type: z.literal("call.started") }),
  z.object({
    ...webhookEnvelope,
    data: webhookEvalCompletedData,
    type: z.literal("eval.completed"),
  }),
  z.object({ ...webhookEnvelope, data: webhookLeadCreatedData, type: z.literal("lead.created") }),
]);

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

const webhookEventsSchema = z
  .array(webhookEventTypeSchema)
  .min(1)
  .max(WEBHOOK_EVENT_TYPES.length)
  .refine((events) => new Set(events).size === events.length);
const webhookUrlSchema = z.url().refine((value) => {
  const { hash, password, protocol, username } = new URL(value);
  return (protocol === "http:" || protocol === "https:") && !username && !password && !hash;
}, "URL must use HTTP or HTTPS without credentials or a fragment");

export const webhookEndpointCreateSchema = z.object({
  enabled: z.boolean().default(true),
  events: webhookEventsSchema,
  name: z.string().trim().min(1).max(100),
  url: webhookUrlSchema,
});

export const webhookEndpointUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    events: webhookEventsSchema.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    url: webhookUrlSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "At least one field is required"
  );

export const webhookDeliveryJobSchema = z.object({
  deliveryId: z.uuid(),
  replay: z.number().int().nonnegative().default(0),
});

export type WebhookDeliveryJob = z.infer<typeof webhookDeliveryJobSchema>;
