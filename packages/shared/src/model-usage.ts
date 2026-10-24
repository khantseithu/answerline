import { z } from "zod";

const model = { model: z.string().min(1), provider: z.string().min(1) };

export const modelUsageSchema = z.discriminatedUnion("stage", [
  z.object({
    ...model,
    quantity: z.number().nonnegative(),
    stage: z.literal("stt"),
    unit: z.literal("seconds"),
  }),
  z.object({
    ...model,
    quantity: z.int().nonnegative(),
    stage: z.literal("llm"),
    unit: z.enum(["input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_tokens"]),
  }),
  z.object({
    ...model,
    quantity: z.int().nonnegative(),
    stage: z.literal("tts"),
    unit: z.literal("characters"),
  }),
]);

export const costLineSchema = z.intersection(
  modelUsageSchema,
  z.object({
    costUsd: z.number().nonnegative().nullable(),
    unitPriceUsd: z.number().nonnegative().nullable(),
  })
);

export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type CostLine = z.infer<typeof costLineSchema>;
