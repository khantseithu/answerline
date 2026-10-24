import type { CostLine, ModelUsage } from "@answerline/shared";
import { z } from "zod";

const costPriceSchema = z
  .object({
    model: z.string().min(1),
    provider: z.string().min(1),
    stage: z.enum(["stt", "llm", "tts"]),
    unit: z.enum([
      "seconds",
      "input_tokens",
      "output_tokens",
      "cached_input_tokens",
      "cache_creation_tokens",
      "characters",
    ]),
    unitPriceUsd: z.number().finite().nonnegative(),
  })
  .superRefine((price, context) => {
    const valid =
      (price.stage === "stt" && price.unit === "seconds") ||
      (price.stage === "llm" && price.unit !== "seconds" && price.unit !== "characters") ||
      (price.stage === "tts" && price.unit === "characters");
    if (!valid) {
      context.addIssue({ code: "custom", message: "unit does not match stage", path: ["unit"] });
    }
  });

export type CostPrice = z.infer<typeof costPriceSchema>;

const defaultPrices: CostPrice[] = [
  {
    model: "nova-3",
    provider: "deepgram",
    stage: "stt",
    unit: "seconds",
    unitPriceUsd: 0.0048 / 60,
  },
  {
    model: "gpt-4.1-mini",
    provider: "openai",
    stage: "llm",
    unit: "input_tokens",
    unitPriceUsd: 0.4 / 1_000_000,
  },
  {
    model: "gpt-4.1-mini",
    provider: "openai",
    stage: "llm",
    unit: "cached_input_tokens",
    unitPriceUsd: 0.1 / 1_000_000,
  },
  {
    model: "gpt-4.1-mini",
    provider: "openai",
    stage: "llm",
    unit: "output_tokens",
    unitPriceUsd: 1.6 / 1_000_000,
  },
  {
    model: "gemini-2.5-flash",
    provider: "google",
    stage: "llm",
    unit: "input_tokens",
    unitPriceUsd: 0.3 / 1_000_000,
  },
  {
    model: "gemini-2.5-flash",
    provider: "google",
    stage: "llm",
    unit: "cached_input_tokens",
    unitPriceUsd: 0.03 / 1_000_000,
  },
  {
    model: "gemini-2.5-flash",
    provider: "google",
    stage: "llm",
    unit: "output_tokens",
    unitPriceUsd: 2.5 / 1_000_000,
  },
  {
    model: "sonic-3",
    provider: "cartesia",
    stage: "tts",
    unit: "characters",
    unitPriceUsd: 65 / 1_000_000,
  },
];

function priceKey(price: Pick<CostPrice, "stage" | "provider" | "model" | "unit">) {
  return `${price.stage}/${price.provider}/${price.model}/${price.unit}`;
}

export function calculateCallCost(
  modelUsage: ModelUsage[] | undefined,
  priceOverrides: CostPrice[] = []
): { costUsd: number | null; costBreakdown: CostLine[] } {
  if (!modelUsage?.length) {
    return { costBreakdown: [], costUsd: null };
  }

  const prices = new Map(defaultPrices.map((price) => [priceKey(price), price.unitPriceUsd]));
  for (const price of priceOverrides) {
    const parsed = costPriceSchema.parse(price);
    prices.set(priceKey(parsed), parsed.unitPriceUsd);
  }

  let total = 0;
  let unpriced = false;
  const costBreakdown = modelUsage.map((usage) => {
    const price = prices.get(priceKey(usage));
    if (price === undefined && usage.quantity > 0) {
      unpriced = true;
    }
    const costUsd = price === undefined ? null : usage.quantity * price;
    if (costUsd !== null) {
      total += costUsd;
    }
    return { ...usage, costUsd, unitPriceUsd: price ?? null };
  });

  return {
    costBreakdown,
    costUsd: unpriced ? null : Math.round(total * 1_000_000) / 1_000_000,
  };
}

export function parseCostPrices(value: string | undefined): CostPrice[] {
  if (!value) {
    return [];
  }
  return z.array(costPriceSchema).parse(JSON.parse(value));
}
