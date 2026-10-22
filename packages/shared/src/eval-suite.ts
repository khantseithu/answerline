import { parse } from "yaml";
import { z } from "zod";

export const evalCaseSchema = z.object({
  caller: z.string().min(1),
  expect: z.object({
    judge: z.string().optional(),
    mentions: z.array(z.string()).optional(),
    not_mentions: z.array(z.string()).optional(),
    tool_called: z.string().optional(),
  }),
  name: z.string().min(1),
});

export const evalSuiteSchema = z.array(evalCaseSchema).min(1);

export type EvalCase = z.infer<typeof evalCaseSchema>;

export function parseEvalSuite(source: string): EvalCase[] {
  return evalSuiteSchema.parse(parse(source));
}
