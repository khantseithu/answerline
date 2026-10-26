import { parse } from "yaml";
import { z } from "zod";

export const modelRefSchema = z
  .string()
  .regex(/^[a-z0-9-]+\/(?:[\w.:-]+\/)?[\w.:-]+$/, "expected provider/model");

const knowledgeSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: z.url() }),
  z.object({ path: z.string().min(1), type: z.literal("file") }),
  z.object({ answer: z.string(), question: z.string(), type: z.literal("qa") }),
]);

const builtinTool = z
  .object({
    builtin: z.enum(["business_hours", "capture_lead", "voicemail"]),
  })
  .catchall(z.unknown());

const transferCallTool = z
  .object({
    builtin: z.literal("transfer_call"),
    to: z.string().regex(/^(\+[1-9]\d{6,14}|sips?:\S+)$/, "expected E.164 number or sip: URI"),
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

const timeRange = z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/);

const holiday = z.object({
  date: z.iso.date(),
  hours: timeRange.optional(),
  name: z.string().min(1).optional(),
});

export const languageCodeSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "expected BCP-47 language code");

const languageOverride = z.object({
  greeting: z.string().min(1).optional(),
  instructions: z.string().min(1).optional(),
});

export const agentConfigSchema = z.object({
  greeting: z.string().min(1),
  hours: z
    .object({
      after_hours: z.enum(["voicemail", "transfer", "answer"]).default("voicemail"),
      holidays: z.array(holiday).default([]),
      timezone: z.string(),
      weekdays: timeRange,
      weekends: timeRange.optional(),
    })
    .optional(),
  instructions: z.string().min(1),
  knowledge: z.object({ sources: z.array(knowledgeSource).default([]) }).optional(),
  language: z.string().default("en"),
  languages: z.record(languageCodeSchema, languageOverride).optional(),
  models: z.object({
    llm: z.object({
      fallback: z.array(modelRefSchema).default([]),
      primary: modelRefSchema,
    }),
    stt: modelRefSchema,
    tts: modelRefSchema,
  }),
  name: z.string().min(1),
  recording: recording.prefault({}),
  tools: z
    .array(z.union([builtinTool, transferCallTool, bookAppointmentTool, httpTool, mcpTool]))
    .default([]),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function parseAgentConfig(source: string): AgentConfig {
  return agentConfigSchema.parse(parse(source));
}
