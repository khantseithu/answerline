import { z } from "zod";

export const phoneNumberView = z.object({
  agent: z.string().nullable(),
  number: z.string(),
});

export const agentOption = z.object({ name: z.string(), slug: z.string() });

export const phoneNumberList = z.object({
  agents: z.array(agentOption),
  numbers: z.array(phoneNumberView),
});

export type PhoneNumberView = z.infer<typeof phoneNumberView>;
export type AgentOption = z.infer<typeof agentOption>;
export type PhoneNumberList = z.infer<typeof phoneNumberList>;
