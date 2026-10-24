import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCallCost, parseCostPrices } from "./costs.ts";

test("calculates known provider rates with actual model usage and rounds only the total", () => {
  const result = calculateCallCost([
    { model: "nova-3", provider: "deepgram", quantity: 60, stage: "stt", unit: "seconds" },
    {
      model: "gpt-4.1-mini",
      provider: "openai",
      quantity: 1000,
      stage: "llm",
      unit: "input_tokens",
    },
    { model: "sonic-3", provider: "cartesia", quantity: 1000, stage: "tts", unit: "characters" },
  ]);
  assert.equal(result.costUsd, 0.0702);
  assert.equal(result.costBreakdown[0]?.unitPriceUsd, 0.0048 / 60);
});

test("leaves total unknown when positive usage has no matching price", () => {
  const result = calculateCallCost([
    { model: "model-x", provider: "custom", quantity: 25, stage: "llm", unit: "input_tokens" },
    { model: "gpt-4.1-mini", provider: "openai", quantity: 0, stage: "llm", unit: "output_tokens" },
  ]);
  assert.equal(result.costUsd, null);
  assert.equal(result.costBreakdown[0]?.costUsd, null);
  assert.equal(result.costBreakdown[1]?.costUsd, 0);
});

test("uses explicit zero overrides and treats missing usage as unknown", () => {
  const prices = parseCostPrices(
    '[{"stage":"llm","provider":"custom","model":"free-model","unit":"input_tokens","unitPriceUsd":0}]'
  );
  assert.deepEqual(
    calculateCallCost(
      [
        {
          model: "free-model",
          provider: "custom",
          quantity: 40,
          stage: "llm",
          unit: "input_tokens",
        },
      ],
      prices
    ),
    {
      costBreakdown: [
        {
          costUsd: 0,
          model: "free-model",
          provider: "custom",
          quantity: 40,
          stage: "llm",
          unit: "input_tokens",
          unitPriceUsd: 0,
        },
      ],
      costUsd: 0,
    }
  );
  assert.deepEqual(calculateCallCost(undefined), { costBreakdown: [], costUsd: null });
});

test("rejects override units that do not match their stage", () => {
  assert.throws(() =>
    parseCostPrices(
      '[{"stage":"stt","provider":"deepgram","model":"nova-3","unit":"input_tokens","unitPriceUsd":0}]'
    )
  );
});
