import { parse } from "yaml";
import { z } from "zod";
import { agentConfigSchema, modelRefSchema } from "./agent-config.ts";
import { modelUsageSchema } from "./model-usage.ts";

const evalExpectationSchema = z.object({
  judge: z.string().optional(),
  max_wer: z.number().min(0).max(1).optional(),
  mentions: z.array(z.string()).optional(),
  not_mentions: z.array(z.string()).optional(),
  pronounces: z.array(z.string().min(1)).optional(),
  tool_args: z.record(z.string(), z.record(z.string(), z.json())).optional(),
  tool_called: z.string().optional(),
});

export const evalCaseSchema = z.object({
  caller: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  expect: evalExpectationSchema,
  mocks: z.record(z.string(), z.json()).optional(),
  name: z.string().min(1),
});

export const evalSuiteSchema = z
  .array(evalCaseSchema)
  .min(1)
  .refine((suite) => new Set(suite.map((item) => item.name)).size === suite.length, {
    message: "eval case names must be unique",
  });

export const evalTranscriptTurnSchema = z.object({
  role: z.enum(["caller", "agent"]),
  text: z.string(),
});

const stageSamplesSchema = z.array(z.number().int().nonnegative());

export const evalStageLatencySchema = z.object({
  llmTotalMs: stageSamplesSchema.optional(),
  llmTtftMs: stageSamplesSchema.optional(),
  sttMs: stageSamplesSchema.optional(),
  ttsTtfbMs: stageSamplesSchema.optional(),
});

const stagePercentilesSchema = z.object({
  p50: z.number().int().nonnegative(),
  p95: z.number().int().nonnegative(),
});

export const evalRunStageLatencySchema = z.object({
  llmTotalMs: stagePercentilesSchema.optional(),
  llmTtftMs: stagePercentilesSchema.optional(),
  sttMs: stagePercentilesSchema.optional(),
  ttsTtfbMs: stagePercentilesSchema.optional(),
});

export const evalPronunciationSchema = z.object({
  checked: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  missed: z.array(z.string()),
});

export const evalCaseResultSchema = z.object({
  caseName: z.string().min(1),
  costUsd: z.number().nonnegative().nullable(),
  failures: z.array(z.string()),
  latencyMs: z.number().int().nonnegative().nullable(),
  modelUsage: z.array(modelUsageSchema).optional(),
  passed: z.boolean(),
  pronunciation: evalPronunciationSchema.nullable().optional(),
  stageLatency: evalStageLatencySchema.optional(),
  transcript: z.array(evalTranscriptTurnSchema),
  wer: z.number().nonnegative().nullable(),
});

export const evalRunAggregateSchema = z.object({
  avgLatencyMs: z.number().int().nonnegative().nullable(),
  avgWer: z.number().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  passed: z.number().int().nonnegative(),
  pronunciationScore: z.number().min(0).max(1).nullable().optional(),
  stageLatency: evalRunStageLatencySchema.nullable().optional(),
  total: z.number().int().nonnegative(),
});

export const evalExecutionOutputSchema = z.object({
  aggregate: evalRunAggregateSchema,
  results: z.array(evalCaseResultSchema),
});

export const evalCallerAudioSchema = z.object({
  noiseSnrDb: z.number().min(0).max(60).optional(),
  profile: z.enum(["clean", "phone"]).default("clean"),
  seed: z.number().int().nonnegative().default(0),
  tts: modelRefSchema.optional(),
  voice: z.string().trim().min(1).max(200).optional(),
});

export const evalExecutionInputSchema = z
  .object({
    agent: agentConfigSchema,
    callerAudio: evalCallerAudioSchema.optional(),
    context: z
      .object({
        agentSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
        tenantSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
      })
      .optional(),
    judgeModel: modelRefSchema.optional(),
    liveTools: z.boolean().default(false),
    mode: z.enum(["text", "audio"]).default("text"),
    modelOverride: modelRefSchema.optional(),
    referenceStt: modelRefSchema.optional(),
    sttOverride: modelRefSchema.optional(),
    suite: evalSuiteSchema,
    ttsOverride: modelRefSchema.optional(),
  })
  .refine((input) => !input.liveTools || input.context !== undefined, {
    message: "live tools require agent and tenant slugs in context",
    path: ["context"],
  });

export const evalJobSchema = z.object({
  agentId: z.uuid().toLowerCase(),
  runId: z.uuid().toLowerCase(),
  tenantId: z.uuid().toLowerCase(),
});

export const evalRunCreateSchema = z.object({
  agentId: z.uuid().toLowerCase(),
  callerAudio: evalCallerAudioSchema.optional(),
  judgeModel: modelRefSchema.optional(),
  liveTools: z.boolean().optional(),
  mode: z.enum(["text", "audio"]).optional(),
  modelOverride: modelRefSchema.optional(),
  referenceStt: modelRefSchema.optional(),
  sttOverride: modelRefSchema.optional(),
  suite: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected suite basename slug"),
  ttsOverride: modelRefSchema.optional(),
});

export type EvalCallerAudio = z.infer<typeof evalCallerAudioSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalCaseResult = z.infer<typeof evalCaseResultSchema>;
export type EvalExecutionInput = z.infer<typeof evalExecutionInputSchema>;
export type EvalExecutionOutput = z.infer<typeof evalExecutionOutputSchema>;
export type EvalJob = z.infer<typeof evalJobSchema>;
export type EvalPronunciation = z.infer<typeof evalPronunciationSchema>;
export type EvalRunAggregate = z.infer<typeof evalRunAggregateSchema>;
export type EvalRunStageLatency = z.infer<typeof evalRunStageLatencySchema>;
export type EvalStageLatency = z.infer<typeof evalStageLatencySchema>;
export type EvalRunCreate = z.infer<typeof evalRunCreateSchema>;

export function parseEvalSuite(source: string): EvalCase[] {
  return evalSuiteSchema.parse(parse(source));
}
