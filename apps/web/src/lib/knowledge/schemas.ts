import { questionAnswerPairs } from "@answerline/shared";
import { z } from "zod";

export const MAX_TEXT_CHARS = 500_000;
export const MAX_QA_PAIRS = 500;

const optionalTitle = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value || undefined)
  .optional();
const requiredTitle = z.string().trim().min(1, "Title is required").max(200);

const httpUrl = z
  .url()
  .max(2048)
  .transform((value) => new URL(value))
  .refine(
    (url) => ["http:", "https:"].includes(url.protocol) && !url.username && !url.password,
    "Use an http(s) URL without credentials"
  )
  .transform((url) => url.href);

export const createKnowledgeSource = z.discriminatedUnion("type", [
  z.strictObject({ title: optionalTitle, type: z.literal("url"), url: httpUrl }),
  z.strictObject({
    content: z.string().trim().min(1, "Text is required").max(MAX_TEXT_CHARS),
    title: requiredTitle,
    type: z.literal("text"),
  }),
  z.strictObject({
    pairs: questionAnswerPairs.max(MAX_QA_PAIRS),
    title: requiredTitle,
    type: z.literal("qa"),
  }),
]);

export type CreateKnowledgeSource = z.infer<typeof createKnowledgeSource>;

export const knowledgeSourceId = z.uuid();
