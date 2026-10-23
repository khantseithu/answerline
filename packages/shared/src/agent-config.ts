import { parse } from "yaml";
import { z } from "zod";

const modelRef = z.string().regex(/^[a-z0-9-]+\/[\w.:-]+$/, "expected provider/model");

const knowledgeSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: z.url() }),
  z.object({ path: z.string().min(1), type: z.literal("file") }),
  z.object({ answer: z.string(), question: z.string(), type: z.literal("qa") }),
]);

const builtinTool = z
  .object({
    builtin: z.enum(["transfer_call", "business_hours", "capture_lead"]),
  })
  .catchall(z.unknown());

const bookAppointmentTool = z
  .object({
    builtin: z.literal("book_appointment"),
    provider: z.enum(["answerline", "cal_com"]).default("answerline"),
    slot_minutes: z.int().min(5).max(480).default(30),
  })
  .catchall(z.unknown());

const httpTool = z.object({
  http: z.object({
    description: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    url: z.string().min(1),
  }),
});

const mcpTool = z.object({
  mcp: z.object({ name: z.string().min(1), url: z.url() }),
});

export const DEFAULT_RECORDING_NOTICE =
  "This call may be recorded for quality and training purposes.";

const recording = z.object({
  enabled: z.boolean().default(false),
  notice: z.string().min(1).default(DEFAULT_RECORDING_NOTICE),
});

export const agentConfigSchema = z.object({
  greeting: z.string().min(1),
  hours: z
    .object({
      after_hours: z.enum(["voicemail", "transfer", "answer"]).default("voicemail"),
      timezone: z.string(),
      weekdays: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/),
      weekends: z
        .string()
        .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
        .optional(),
    })
    .optional(),
  instructions: z.string().min(1),
  knowledge: z.object({ sources: z.array(knowledgeSource).default([]) }).optional(),
  language: z.string().default("en"),
  models: z.object({
    llm: z.object({
      fallback: z.array(modelRef).default([]),
      primary: modelRef,
    }),
    stt: modelRef,
    tts: modelRef,
  }),
  name: z.string().min(1),
  recording: recording.prefault({}),
  tools: z.array(z.union([builtinTool, bookAppointmentTool, httpTool, mcpTool])).default([]),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function parseAgentConfig(source: string): AgentConfig {
  return agentConfigSchema.parse(parse(source));
}
