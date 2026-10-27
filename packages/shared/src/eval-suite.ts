import { parse } from "yaml";
import { z } from "zod";
import { agentConfigSchema, modelRefSchema } from "./agent-config.ts";
import { modelUsageSchema } from "./model-usage.ts";

const evalExpectationSchema = z.object({
  judge: z.string().optional(),
  mentions: z.array(z.string()).optional(),
  not_mentions: z.array(z.string()).optional(),
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

export const evalCaseResultSchema = z.object({
  caseName: z.string().min(1),
  costUsd: z.number().nonnegative().nullable(),
  failures: z.array(z.string()),
  latencyMs: z.number().int().nonnegative().nullable(),
  modelUsage: z.array(modelUsageSchema).optional(),
  passed: z.boolean(),
  transcript: z.array(evalTranscriptTurnSchema),
});

export const evalRunAggregateSchema = z.object({
  avgLatencyMs: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const evalExecutionOutputSchema = z.object({
  aggregate: evalRunAggregateSchema,
  results: z.array(evalCaseResultSchema),
});

export const evalExecutionInputSchema = z
  .object({
    agent: agentConfigSchema,
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
    suite: evalSuiteSchema,
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
  judgeModel: modelRefSchema.optional(),
  liveTools: z.boolean().optional(),
  mode: z.enum(["text", "audio"]).optional(),
  modelOverride: modelRefSchema.optional(),
  suite: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected suite basename slug"),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalCaseResult = z.infer<typeof evalCaseResultSchema>;
export type EvalExecutionInput = z.infer<typeof evalExecutionInputSchema>;
export type EvalExecutionOutput = z.infer<typeof evalExecutionOutputSchema>;
export type EvalJob = z.infer<typeof evalJobSchema>;
export type EvalRunAggregate = z.infer<typeof evalRunAggregateSchema>;
export type EvalRunCreate = z.infer<typeof evalRunCreateSchema>;

export function parseEvalSuite(source: string): EvalCase[] {
  return evalSuiteSchema.parse(parse(source));
}
