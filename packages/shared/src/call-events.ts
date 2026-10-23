import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

const callRef = {
  agent: slug,
  room_name: z.string().min(1),
  tenant: slug,
};

export const callStartedJob = z.object({
  ...callRef,
  channel: z.enum(["web", "sip"]),
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  from_number: z.string().optional(),
  started_at: z.iso.datetime({ offset: true }),
  to_number: z.string().optional(),
  type: z.literal("call.started"),
});

export const callTurnJob = z.object({
  ...callRef,
  ended_at: z.iso.datetime({ offset: true }).optional(),
  interrupted: z.boolean().default(false),
  latency: z
    .object({
      llm_ttft_ms: z.number().nonnegative().optional(),
      stt_ms: z.number().nonnegative().optional(),
      tts_ttfb_ms: z.number().nonnegative().optional(),
    })
    .optional(),
  role: z.enum(["caller", "agent"]),
  seq: z.number().int().nonnegative(),
  started_at: z.iso.datetime({ offset: true }),
  text: z.string(),
  type: z.literal("call.turn"),
});

export const callToolJob = z.object({
  ...callRef,
  args: z.record(z.string(), z.unknown()),
  error: z.string().optional(),
  latency_ms: z.number().int().nonnegative(),
  name: z.string().min(1),
  result: z.unknown().optional(),
  seq: z.number().int().nonnegative(),
  started_at: z.iso.datetime({ offset: true }),
  status: z.enum(["ok", "error", "timeout"]),
  type: z.literal("call.tool"),
});

export const callEndedJob = z.object({
  ...callRef,
  duration_ms: z.number().int().nonnegative(),
  ended_at: z.iso.datetime({ offset: true }),
  recording_url: z.string().min(1).optional(),
  status: z.enum(["completed", "failed"]),
  type: z.literal("call.ended"),
  usage: z.record(z.string(), z.number()).optional(),
});

const leadWhitespace =
  "\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f\u0020\u0085\u00a0\u1680" +
  "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" +
  "\u2028\u2029\u202f\u205f\u3000\ufeff";
const leadTextPattern = new RegExp(`[^${leadWhitespace}]`);

const leadText = (maxLength: number) =>
  z
    .string()
    .regex(new RegExp(`^[\\s\\S]{1,${maxLength}}(?![\\s\\S])`, "u"))
    .regex(leadTextPattern);

export const leadCreatedJob = z.object({
  ...callRef,
  created_at: z.iso.datetime({ offset: true }),
  lead_id: z.uuid().toLowerCase(),
  name: leadText(200),
  phone: leadText(100),
  reason: leadText(2000),
  type: z.literal("lead.created"),
});

export const callEventJob = z.discriminatedUnion("type", [
  callStartedJob,
  callTurnJob,
  callToolJob,
  callEndedJob,
  leadCreatedJob,
]);

export type CallEventJob = z.infer<typeof callEventJob>;

export function callEventJobId(event: CallEventJob): string {
  if (event.type === "lead.created") {
    return `${event.room_name}_${event.type}_${event.lead_id}`;
  }
  return event.type === "call.turn" || event.type === "call.tool"
    ? `${event.room_name}_${event.type}_${event.seq}`
    : `${event.room_name}_${event.type}`;
}
