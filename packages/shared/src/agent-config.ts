import { parse } from "yaml";
import { z } from "zod";

const modelRef = z.string().regex(/^[a-z0-9-]+\/[\w.:-]+$/, "expected provider/model");

const knowledgeSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: z.url() }),
  z.object({ type: z.literal("file"), path: z.string().min(1) }),
  z.object({ type: z.literal("qa"), question: z.string(), answer: z.string() }),
]);

const builtinTool = z
  .object({
    builtin: z.enum(["book_appointment", "transfer_call", "business_hours", "capture_lead"]),
  })
  .catchall(z.unknown());

const httpTool = z.object({
  http: z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
  }),
});

const mcpTool = z.object({
  mcp: z.object({ name: z.string().min(1), url: z.url() }),
});

export const agentConfigSchema = z.object({
  name: z.string().min(1),
  greeting: z.string().min(1),
  language: z.string().default("en"),
  instructions: z.string().min(1),
  models: z.object({
    stt: modelRef,
    llm: z.object({
      primary: modelRef,
      fallback: z.array(modelRef).default([]),
    }),
    tts: modelRef,
  }),
  knowledge: z.object({ sources: z.array(knowledgeSource).default([]) }).optional(),
  tools: z.array(z.union([builtinTool, httpTool, mcpTool])).default([]),
  hours: z
    .object({
      timezone: z.string(),
      weekdays: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/),
      weekends: z
        .string()
        .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
        .optional(),
      after_hours: z.enum(["voicemail", "transfer", "answer"]).default("voicemail"),
    })
    .optional(),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function parseAgentConfig(source: string): AgentConfig {
  return agentConfigSchema.parse(parse(source));
}
