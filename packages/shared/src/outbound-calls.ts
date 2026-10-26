import { z } from "zod";

const agentSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const phoneNumberSchema = z.string().regex(/^\+[1-9]\d{6,14}$/);

export const outboundCallRequestSchema = z.object({
  agent: agentSlugSchema,
  toNumber: phoneNumberSchema,
});

export const outboundCallResponseSchema = z.object({
  callId: z.uuid(),
  roomName: z.string().min(1),
  status: z.literal("initiated"),
});

export type OutboundCallRequest = z.infer<typeof outboundCallRequestSchema>;
export type OutboundCallResponse = z.infer<typeof outboundCallResponseSchema>;
