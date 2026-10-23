import { z } from "zod";

export const ingestionJob = z.strictObject({
  sourceId: z.uuid(),
  tenantId: z.uuid(),
});

export type IngestionJob = z.infer<typeof ingestionJob>;

export const questionAnswerPairs = z
  .array(z.strictObject({ answer: z.string().trim().min(1), question: z.string().trim().min(1) }))
  .min(1);

export type QuestionAnswerPairs = z.infer<typeof questionAnswerPairs>;
