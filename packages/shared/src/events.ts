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

export const webhookEventSchema = z.object({
  created_at: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
  id: z.string().min(1),
  type: webhookEventTypeSchema,
});

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
